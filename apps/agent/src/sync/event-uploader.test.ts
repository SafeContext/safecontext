import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckReport } from '../events.ts';
import { memoryLogger } from '../log.ts';
import { CANARY } from '../test-helpers.ts';
import { createDashboardClient } from './dashboard-client.ts';
import { createDeviceAuth } from './device-auth.ts';
import { backoffDelay, createEventUploader } from './event-uploader.ts';
import { ENROLLMENT_KEY, startFakeDashboard, type FakeDashboard } from './fake-dashboard.ts';
import { syncLogger } from './log.ts';
import { memoryTokenStore } from './token-store.ts';

const DEVICE = 'dev-events-test';
let dash: FakeDashboard;
beforeEach(async () => {
	dash = await startFakeDashboard();
	// Fake the uploader's backoff timer and the clock, so a retry happens exactly when a test fires
	// it (`retryNow` in `setup`) and never depends on how fast the machine is. HTTP to the fake
	// dashboard is real.
	vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
});
afterEach(async () => {
	vi.useRealTimers();
	await dash.close();
});

const report = (overrides: Partial<CheckReport> = {}): CheckReport => ({
	ts: new Date().toISOString(),
	policyVersion: 1,
	hookEvent: 'PostToolUse',
	toolName: 'Read',
	counts: { 'api-keys': 1 },
	actions: { block: 1 },
	blocked: true,
	latencyMs: 2.5,
	...overrides
});

function setup(opts: { batchSize?: number; maxQueue?: number; backoffBaseMs?: number } = {}) {
	const logger = memoryLogger();
	const auth = createDeviceAuth({
		client: createDashboardClient({ baseUrl: dash.url, timeoutMs: 2_000 }),
		store: memoryTokenStore(),
		deviceId: DEVICE,
		enrollmentKey: ENROLLMENT_KEY,
		logger: syncLogger(logger)
	});
	const uploader = createEventUploader({
		client: createDashboardClient({ baseUrl: dash.url, timeoutMs: 2_000 }),
		auth,
		logger: syncLogger(logger),
		batchSize: opts.batchSize ?? 100,
		flushIntervalMs: 60_000,
		maxQueue: opts.maxQueue ?? 1_000,
		backoffBaseMs: opts.backoffBaseMs ?? 5,
		backoffMaxMs: Math.max(20, opts.backoffBaseMs ?? 0),
		random: () => 1
	});
	/** Let the backoff the uploader last logged run out, and wait for the retry its timer starts. */
	async function retryNow() {
		const backoffs = logger.records.flatMap((r) => ('retryInMs' in r ? [r.retryInMs as number] : []));
		vi.advanceTimersByTime(backoffs.at(-1)!);
		await uploader.flush(); // Joins the upload the timer started.
	}
	return { uploader, logger, retryNow };
}

const sent = () => dash.batches.flat();

describe('createEventUploader', () => {
	it('adds the device id and uploads in batches', async () => {
		const { uploader } = setup({ batchSize: 2 });
		for (let i = 0; i < 5; i++) uploader.record(report({ latencyMs: i }));
		// A full batch starts an upload, which keeps going until the queue is empty: join it.
		await uploader.flush();
		expect(sent()).toHaveLength(5);
		expect(dash.batches.map((b) => b.length)).toEqual([2, 2, 1]);
		expect(sent().every((e) => e.deviceId === DEVICE)).toBe(true);
		expect(sent().map((e) => e.latencyMs)).toEqual([0, 1, 2, 3, 4]);
		expect(uploader.pending).toBe(0);
	});

	it('never sends text: an event with an extra field is dropped, not uploaded', async () => {
		const { uploader, logger } = setup();
		uploader.record({ ...report(), prompt: CANARY } as CheckReport);
		uploader.record(report({ toolName: `bad name ${CANARY}` }));
		uploader.record(report());
		await uploader.flush();
		expect(sent()).toHaveLength(1);
		expect(dash.rawEventBodies.join('')).not.toContain(CANARY);
		expect(JSON.stringify(logger.records)).not.toContain(CANARY);
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'invalid_event', events: 2 });
	});

	it('retries server errors with backoff, keeping order', async () => {
		dash.override.set('/api/events', [{ status: 503 }, { status: 502 }]);
		const { uploader, logger, retryNow } = setup();
		uploader.record(report({ latencyMs: 1 }));
		uploader.record(report({ latencyMs: 2 }));
		await uploader.flush();
		expect(sent()).toHaveLength(0);
		expect(uploader.pending).toBe(2);
		await retryNow(); // 502
		expect(sent()).toHaveLength(0);
		await retryNow();
		expect(sent().map((e) => e.latencyMs)).toEqual([1, 2]);
		const failures = logger.records.filter((r) => r.msg === ('events_upload_failed' as never));
		expect(failures.map((r) => (r as { retryInMs?: number }).retryInMs)).toEqual([5, 10]);
	});

	it('respects Retry-After on 429', async () => {
		dash.override.set('/api/events', [
			{ status: 429, headers: { 'retry-after': '1' }, body: { error: { code: 'rate_limited', message: 'x' } } }
		]);
		const { uploader, logger } = setup();
		uploader.record(report());
		await uploader.flush();
		expect(logger.records).toContainEqual(
			expect.objectContaining({ msg: 'events_upload_failed', reason: 'rate_limited', status: 429, retryInMs: 1000 })
		);
		vi.advanceTimersByTime(999);
		await uploader.flush(); // Still waiting: nothing sent.
		expect(dash.requests.filter((r) => r.path === '/api/events')).toHaveLength(1);
		vi.advanceTimersByTime(1);
		await uploader.flush(); // Joins the retry the timer started.
		expect(sent()).toHaveLength(1);
	});

	it('retries when its timer fires, even if the wall clock says the backoff is not over', async () => {
		// Timers and Date.now() can disagree (rounding, or the system clock being set back). The retry
		// used to be skipped then, with no new one scheduled, which stalled uploads (issue #68).
		dash.override.set('/api/events', [{ status: 503 }]);
		const { uploader, retryNow } = setup();
		uploader.record(report());
		await uploader.flush();
		vi.setSystemTime(Date.now() - 60 * 60_000); // The clock goes back an hour; the timer doesn't.
		await retryNow();
		expect(sent()).toHaveLength(1);
	});

	it('registers again on 401 and resends', async () => {
		const { uploader, retryNow } = setup();
		uploader.record(report());
		await uploader.flush();
		dash.tokens.clear();
		uploader.record(report());
		await uploader.flush(); // 401: the token is dropped and the batch kept.
		expect(sent()).toHaveLength(1);
		await retryNow();
		expect(sent()).toHaveLength(2);
		expect(dash.registrations).toBe(2);
	});

	it('drops a batch the dashboard refuses as invalid, and splits one that is too large', async () => {
		dash.override.set('/api/events', [
			{ status: 422, body: { error: { code: 'invalid_body', message: 'x' } } },
			{ status: 413, body: { error: { code: 'bad_request', message: 'x' } } }
		]);
		const { uploader, logger } = setup({ batchSize: 4 });
		uploader.record(report());
		await uploader.flush();
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'rejected', events: 1 });
		for (let i = 0; i < 4; i++) uploader.record(report());
		await uploader.flush();
		expect(sent()).toHaveLength(4);
		expect(dash.batches.map((b) => b.length)).toEqual([2, 2]);
		// The split only applies to that batch: the next one is full size again.
		for (let i = 0; i < 4; i++) uploader.record(report());
		await uploader.flush();
		expect(sent()).toHaveLength(8);
		expect(dash.batches.map((b) => b.length)).toEqual([2, 2, 4]);
	});

	it('retries a 403 that is not device_mismatch (e.g. from a proxy) instead of dropping it', async () => {
		dash.override.set('/api/events', [{ status: 403, body: '<html>Forbidden</html>' }]);
		const { uploader, logger, retryNow } = setup();
		uploader.record(report());
		await uploader.flush();
		expect(logger.records).toContainEqual(
			expect.objectContaining({ msg: 'events_upload_failed', reason: 'forbidden', status: 403 })
		);
		await retryNow();
		expect(sent()).toHaveLength(1);
		expect(dash.registrations).toBe(1);
	});

	it('tries one last send on close even while backing off', async () => {
		dash.override.set('/api/events', [{ status: 503 }]);
		const { uploader } = setup({ backoffBaseMs: 60_000 });
		uploader.record(report());
		await uploader.flush();
		expect(uploader.pending).toBe(1);
		await uploader.close();
		expect(sent()).toHaveLength(1);
		expect(uploader.pending).toBe(0);
	});

	it('drops the oldest events when the queue is full', async () => {
		await dash.close();
		const { uploader, logger } = setup({ maxQueue: 3, batchSize: 100 });
		for (let i = 0; i < 5; i++) uploader.record(report({ latencyMs: i }));
		expect(uploader.pending).toBe(3);
		await uploader.close();
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'queue_full', events: 2 });
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'shutdown', events: 3 });
	});

	it('sends what is queued on close', async () => {
		const { uploader } = setup();
		uploader.record(report());
		await uploader.close();
		expect(sent()).toHaveLength(1);
	});
});

describe('backoffDelay', () => {
	it('doubles up to the cap, with jitter between 50% and 100%', () => {
		expect([0, 1, 2, 3, 10].map((a) => backoffDelay(a, 1_000, 5_000, () => 1))).toEqual([
			1_000, 2_000, 4_000, 5_000, 5_000
		]);
		expect(backoffDelay(1, 1_000, 5_000, () => 0)).toBe(1_000);
	});
});
