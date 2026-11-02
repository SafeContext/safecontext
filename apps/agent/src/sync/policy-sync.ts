/**
 * A `PolicySource` that pulls the policy from the dashboard (`GET /api/policy`) every
 * `intervalMs`, using the ETag so an unchanged policy costs a 304. Every new policy is written to
 * a cache file, so after a restart, or while the dashboard can't be reached, the agent keeps
 * enforcing the last policy it had. With no cache yet, it uses the fallback (the policy file or
 * the built-in default) until the first pull succeeds.
 *
 * Pulls only ever move forward: a policy with a lower version than the last one synced is
 * ignored (SPEC: "the agent keeps the highest version it has seen").
 */
import type { Policy } from '@safecontext/policy';
import type { PolicySource } from '../policy-source.ts';
import type { DeviceAuth } from './device-auth.ts';
import type { DashboardClient } from './dashboard-client.ts';
import type { SyncLogger, SyncLogMessage, SyncReason } from './log.ts';
import { readPolicyCache, writePolicyCache } from './state-files.ts';

export interface SyncingPolicySource extends PolicySource {
	/** Pull once now. Resolves when done; never throws. Concurrent calls share one pull. */
	refresh(): Promise<RefreshOutcome>;
	/** Start pulling: once now, then every `intervalMs`. */
	start(): void;
	close(): void;
}

export type RefreshOutcome = 'updated' | 'unchanged' | 'stale' | 'no_policy' | 'failed';

export interface PolicySyncOptions {
	client: DashboardClient;
	auth: DeviceAuth;
	/** Path of the policy cache file. */
	cacheFile: string;
	/** Used until the cache or the dashboard provides a policy. */
	fallback: PolicySource;
	intervalMs: number;
	logger: SyncLogger;
}

export function syncingPolicySource(opts: PolicySyncOptions): SyncingPolicySource {
	const { client, auth, cacheFile, fallback, intervalMs, logger } = opts;

	/** The last policy from the dashboard (this run, or cached from an earlier one). */
	let synced: Policy | undefined;
	let etag: string | undefined;
	let kind: PolicySource['kind'] = fallback.kind;

	const cached = readPolicyCache(cacheFile);
	if (cached.ok) {
		synced = cached.cache.policy;
		etag = cached.cache.etag;
		kind = 'cache';
		logger.log('info', 'policy_cache_loaded', { policySource: 'cache', policyVersion: synced.version });
	} else if (cached.error !== 'missing') {
		logger.log('warn', 'policy_cache_invalid', {
			reason: cached.error,
			...(cached.issues !== undefined && { issues: cached.issues })
		});
	}

	let timer: NodeJS.Timeout | undefined;
	let closed = false;
	let inFlight: Promise<{ outcome: RefreshOutcome; retryAfterMs?: number }> | undefined;
	/** Last message logged, so a dashboard that stays down doesn't log every interval. */
	let lastLogged: string | undefined;

	function logOnChange(level: 'info' | 'warn', msg: SyncLogMessage, reason?: SyncReason, status?: number) {
		const key = `${msg}:${reason ?? ''}:${status ?? ''}`;
		if (key === lastLogged) return;
		lastLogged = key;
		logger.log(level, msg, {
			...(reason !== undefined && { reason }),
			...(status !== undefined && { status }),
			policyVersion: source.current().version
		});
	}

	/** One pull. Returns the outcome and, for a 429, how long the dashboard asked us to wait. */
	async function pull(): Promise<{ outcome: RefreshOutcome; retryAfterMs?: number }> {
		const token = await auth.token();
		if (token === undefined) {
			logOnChange('warn', 'policy_sync_failed', 'no_token');
			return { outcome: 'failed' };
		}
		const result = await client.getPolicy(token, etag);
		if (result.ok && result.status === 304) {
			kind = 'dashboard';
			logOnChange('info', 'policy_unchanged');
			return { outcome: 'unchanged' };
		}
		if (result.ok) {
			const next = result.policy;
			if (synced !== undefined && next.version < synced.version) {
				logOnChange('warn', 'policy_stale', undefined, 200);
				return { outcome: 'stale' };
			}
			const changed = synced === undefined || next.version !== synced.version || kind !== 'dashboard';
			synced = next;
			etag = result.etag;
			kind = 'dashboard';
			try {
				writePolicyCache(cacheFile, { ...(etag !== undefined && { etag }), policy: next });
			} catch {
				logger.log('warn', 'policy_cache_write_failed');
			}
			lastLogged = undefined;
			if (changed) logger.log('info', 'policy_synced', { policySource: 'dashboard', policyVersion: next.version });
			return { outcome: changed ? 'updated' : 'unchanged' };
		}
		if (result.reason === 'unauthorized') auth.rejected(token);
		if (result.reason === 'no_policy') {
			logOnChange('info', 'policy_sync_failed', 'no_policy', 404);
			return { outcome: 'no_policy' };
		}
		logOnChange('warn', 'policy_sync_failed', result.reason, 'status' in result ? result.status : undefined);
		return {
			outcome: 'failed',
			...(result.reason === 'rate_limited' &&
				result.retryAfterMs !== undefined && { retryAfterMs: result.retryAfterMs })
		};
	}

	function schedule(delayMs: number) {
		if (closed) return;
		clearTimeout(timer);
		timer = setTimeout(tick, delayMs);
		timer.unref();
	}

	async function tick() {
		const { retryAfterMs = 0 } = await pullOnce();
		schedule(Math.max(intervalMs, retryAfterMs));
	}

	type Pulled = { outcome: RefreshOutcome; retryAfterMs?: number };
	function pullOnce(): Promise<Pulled> {
		inFlight ??= pull()
			.catch((): Pulled => ({ outcome: 'failed' }))
			.finally(() => (inFlight = undefined));
		return inFlight;
	}

	const source: SyncingPolicySource = {
		get kind() {
			return kind;
		},
		current: () => synced ?? fallback.current(),
		refresh: () => pullOnce().then((r) => r.outcome),
		start() {
			if (closed || timer !== undefined) return;
			logger.log('info', 'sync_started', { intervalMs });
			schedule(0);
		},
		close() {
			closed = true;
			clearTimeout(timer);
			void fallback.close?.();
		}
	};
	return source;
}
