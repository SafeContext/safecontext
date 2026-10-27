/**
 * An `EventSink` that uploads check reports to the dashboard (`POST /api/events`) in batches.
 *
 * - Adds the device id and checks every event against the strict `AgentEvent` schema, which has
 *   no text fields and rejects unknown ones. An event that fails is dropped, never sent.
 * - Queues in memory (bounded: the oldest events are dropped first when it's full) and sends one
 *   batch at a time, every `flushIntervalMs` or as soon as a full batch is waiting.
 * - Retries network errors, 5xx, 401/403 (after registering again) and 429 with exponential
 *   backoff and jitter, never sooner than `Retry-After`. Batches the dashboard refuses as invalid
 *   are dropped, since resending them can't succeed.
 *
 * The API has no idempotency key, so a batch whose response was lost may be stored twice.
 */
import { AgentEvent } from '@safecontext/policy';
import type { CheckReport, EventSink } from '../events.ts';
import type { DeviceAuth } from './device-auth.ts';
import type { DashboardClient } from './dashboard-client.ts';
import type { SyncLogger, SyncReason } from './log.ts';

/** Contract limits for one `POST /api/events` (AgentEventBatch: 1–500 events, 512 KiB). */
export const MAX_BATCH_EVENTS = 500;
export const MAX_BATCH_BYTES = 512 * 1024;

export interface EventUploaderOptions {
	client: DashboardClient;
	auth: DeviceAuth;
	logger: SyncLogger;
	/** Events per request (1–500). */
	batchSize: number;
	/** How often to send what's queued. */
	flushIntervalMs: number;
	/** Most events kept while the dashboard can't be reached. */
	maxQueue: number;
	/** Backoff after a failed upload: base * 2^attempt, capped at max, with jitter. */
	backoffBaseMs?: number;
	backoffMaxMs?: number;
	random?: () => number;
}

export interface EventUploader extends EventSink {
	/** Send what's queued now (unless waiting out a backoff). Never throws. */
	flush(): Promise<void>;
	/** Start the flush timer. */
	start(): void;
	/** Stop timers and try one last upload. Events still queued afterwards are dropped. */
	close(): Promise<void>;
	/** Events waiting to be sent. */
	readonly pending: number;
}

export const DEFAULT_BACKOFF_BASE_MS = 1_000;
export const DEFAULT_BACKOFF_MAX_MS = 5 * 60_000;

/** Exponential backoff with jitter: a random delay in [50%, 100%] of min(max, base * 2^attempt). */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
	const ceiling = Math.min(maxMs, baseMs * 2 ** Math.min(attempt, 30));
	return Math.round(ceiling * (0.5 + random() * 0.5));
}

export function createEventUploader(opts: EventUploaderOptions): EventUploader {
	const { client, auth, logger, flushIntervalMs, maxQueue } = opts;
	const baseMs = opts.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
	const maxMs = opts.backoffMaxMs ?? DEFAULT_BACKOFF_MAX_MS;
	const random = opts.random ?? Math.random;
	let batchSize = Math.max(1, Math.min(MAX_BATCH_EVENTS, opts.batchSize));

	const queue: AgentEvent[] = [];
	let dropped: Partial<Record<SyncReason, number>> = {};
	let attempt = 0;
	/** Epoch ms before which no upload is attempted. */
	let retryAt = 0;
	let inFlight: Promise<void> | undefined;
	let interval: NodeJS.Timeout | undefined;
	let retryTimer: NodeJS.Timeout | undefined;
	let closed = false;

	function drop(reason: SyncReason, count: number) {
		dropped[reason] = (dropped[reason] ?? 0) + count;
	}

	/** Log drops in one line per reason, rather than one per event. */
	function reportDrops() {
		for (const [reason, events] of Object.entries(dropped) as Array<[SyncReason, number]>) {
			logger.log('warn', 'events_dropped', { reason, events });
		}
		dropped = {};
	}

	function trim() {
		const excess = queue.length - maxQueue;
		if (excess > 0) {
			queue.splice(0, excess);
			drop('queue_full', excess);
		}
	}

	function takeBatch(): AgentEvent[] {
		let n = Math.min(batchSize, queue.length);
		while (n > 1 && Buffer.byteLength(JSON.stringify({ events: queue.slice(0, n) })) > MAX_BATCH_BYTES) {
			n = Math.ceil(n / 2);
		}
		return queue.splice(0, n);
	}

	function backOff(reason: SyncReason, status: number | undefined, retryAfterMs = 0) {
		const delay = Math.max(retryAfterMs, backoffDelay(attempt, baseMs, maxMs, random));
		attempt++;
		retryAt = Date.now() + delay;
		logger.log('warn', 'events_upload_failed', {
			reason,
			...(status !== undefined && { status }),
			events: queue.length,
			retryInMs: delay
		});
		if (!closed) {
			clearTimeout(retryTimer);
			retryTimer = setTimeout(() => void uploader.flush(), delay);
			retryTimer.unref();
		}
	}

	async function drain(): Promise<void> {
		while (queue.length > 0) {
			const token = await auth.token();
			if (token === undefined) return backOff('no_token', undefined);
			const batch = takeBatch();
			const result = await client.postEvents(token, batch);
			if (result.ok) {
				attempt = 0;
				logger.log('info', 'events_uploaded', { events: result.accepted });
				continue;
			}
			switch (result.reason) {
				case 'bad_response':
					// A 2xx: the dashboard stored the batch. Resending would duplicate it.
					logger.log('warn', 'events_upload_failed', { reason: 'bad_response', status: result.status });
					continue;
				case 'too_large':
					if (batch.length > 1) {
						batchSize = Math.ceil(batch.length / 2);
						queue.unshift(...batch);
					} else {
						drop('too_large', 1);
					}
					continue;
				case 'rejected':
					drop('rejected', batch.length);
					logger.log('warn', 'events_upload_failed', { reason: 'rejected', status: result.status });
					continue;
				case 'unauthorized':
				case 'device_mismatch':
					auth.rejected(token);
					break;
			}
			queue.unshift(...batch);
			trim();
			return backOff(
				result.reason,
				'status' in result ? result.status : undefined,
				result.reason === 'rate_limited' ? result.retryAfterMs : undefined
			);
		}
	}

	const uploader: EventUploader = {
		get pending() {
			return queue.length;
		},
		record(report: CheckReport) {
			const parsed = AgentEvent.safeParse({ ...report, deviceId: auth.deviceId });
			if (!parsed.success) {
				drop('invalid_event', 1);
				return;
			}
			queue.push(parsed.data);
			trim();
			if (queue.length >= batchSize && !closed) void uploader.flush();
		},
		flush() {
			inFlight ??= (async () => {
				reportDrops();
				if (queue.length === 0 || Date.now() < retryAt) return;
				await drain();
				reportDrops();
			})()
				.catch(() => {
					// drain() handles every result itself; this only guards against a bug.
				})
				.finally(() => (inFlight = undefined));
			return inFlight;
		},
		start() {
			if (interval !== undefined || closed) return;
			interval = setInterval(() => void uploader.flush(), flushIntervalMs);
			interval.unref();
		},
		async close() {
			closed = true;
			clearInterval(interval);
			clearTimeout(retryTimer);
			await inFlight;
			await uploader.flush();
			if (queue.length > 0) {
				drop('shutdown', queue.length);
				queue.length = 0;
			}
			reportDrops();
		}
	};
	return uploader;
}
