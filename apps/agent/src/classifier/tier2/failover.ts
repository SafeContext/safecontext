/**
 * The company's model server first, this Mac's model when the server can't be used (issue #75).
 *
 * A call goes to the server. If the server can't be reached, times out or answers with an HTTP
 * error, the same call is tried on the local model (if there is time left), and later calls go
 * straight to the local model for `coolOffMs` before the server is tried again. That way a server
 * outage costs one slow call, not one per check. Each later try of the server, while it may still
 * be down, leaves `minLocalMs` of the call for the local model (PR #136 review). An answer that arrives but is wrong (cut off,
 * not the schema) is not an outage: it fails like any bad answer, and the server stays in use.
 *
 * When neither can answer, the call fails and tier 2 fails safe as before: its spans stay flagged.
 */
import { silentLogger, type Logger } from '../../log.ts';
import { Tier2CallError, type ChatOptions, type Tier2Client, type Tier2Reason } from './client.ts';

export interface FailoverOptions {
	server: Tier2Client;
	local: Tier2Client;
	/** After the server fails, use the local model only, for this long. Default 30 s. */
	coolOffMs?: number;
	/** Don't try the local model with less time than this left in the call. Default 1.5 s. */
	minLocalMs?: number;
	logger?: Logger;
	now?: () => number;
}

/** Failures that mean the server isn't usable right now. */
const OUTAGES: ReadonlySet<Tier2Reason> = new Set(['unreachable', 'timeout', 'http_error']);

export function failoverClient({
	server,
	local,
	coolOffMs = 30_000,
	minLocalMs = 1_500,
	logger = silentLogger,
	now = () => performance.now()
}: FailoverOptions): Tier2Client {
	/** Until when calls skip the server. 0: the server is in use. */
	let downUntil = 0;

	return {
		baseUrl: server.baseUrl,
		model: server.model,
		listModels: (timeoutMs) => server.listModels(timeoutMs),

		async chat(options: ChatOptions) {
			const start = now();
			if (now() >= downUntil) {
				// Trying a server that was down: keep time for this Mac in case it still is.
				const probing = downUntil !== 0 && options.timeoutMs - minLocalMs >= minLocalMs;
				try {
					const answer = await server.chat(
						probing ? { ...options, timeoutMs: options.timeoutMs - minLocalMs } : options
					);
					if (downUntil !== 0) {
						downUntil = 0;
						logger.log('info', 'tier2_server_back');
					}
					return answer;
				} catch (err) {
					const reason = err instanceof Tier2CallError ? err.reason : undefined;
					// The check itself ran out of time, or the server answered badly: no fallback.
					if (options.signal?.aborted || reason === undefined || !OUTAGES.has(reason)) throw err;
					if (downUntil === 0) logger.log('warn', 'tier2_failover', { reason });
					downUntil = now() + coolOffMs;
				}
			}
			const left = options.timeoutMs - (now() - start);
			if (left < minLocalMs) throw new Tier2CallError('timeout');
			return local.chat({ ...options, timeoutMs: left });
		}
	};
}
