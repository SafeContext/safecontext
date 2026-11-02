/**
 * Dashboard sync settings, from the environment. With no `SC_DASHBOARD_URL` there is no sync and
 * the agent works as before (policy file or built-in default, no event upload).
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface SyncConfig {
	/** `SC_DASHBOARD_URL`: dashboard base URL. https, or http on loopback for local testing. */
	dashboardUrl: string;
	/**
	 * `SC_ENROLLMENT_KEY`: the organisation's key for registering this device. Only needed until a
	 * device token is in the Keychain. Placeholder for how devices join an org (#51).
	 */
	enrollmentKey: string | undefined;
	/** `SC_STATE_DIR`: device id and policy cache. */
	stateDir: string;
	/** `SC_POLICY_SYNC_INTERVAL_MS`: how often to pull the policy. */
	policyIntervalMs: number;
	/** `SC_EVENT_FLUSH_MS`: how often to upload queued events. */
	eventFlushMs: number;
	/** `SC_EVENT_BATCH_SIZE`: events per upload (max 500, the contract's limit). */
	eventBatchSize: number;
	/** `SC_EVENT_QUEUE_MAX`: events kept in memory while the dashboard can't be reached. */
	eventQueueMax: number;
}

/** 30 s: a policy change reaches agents within about 30 s; the dashboard allows 30 pulls/min. */
export const DEFAULT_POLICY_INTERVAL_MS = 30_000;
/** 5 s: 12 uploads/min at most, inside the dashboard's 60/min per device. */
export const DEFAULT_EVENT_FLUSH_MS = 5_000;
export const DEFAULT_EVENT_BATCH_SIZE = 100;
export const DEFAULT_EVENT_QUEUE_MAX = 5_000;

export function defaultStateDir(home: string = homedir()): string {
	return join(home, 'Library', 'Application Support', 'SafeContext');
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

export function readSyncConfig(env: NodeJS.ProcessEnv): SyncConfig | undefined {
	const raw = env.SC_DASHBOARD_URL?.trim();
	if (!raw) return undefined;
	return {
		dashboardUrl: dashboardUrl(raw),
		enrollmentKey: env.SC_ENROLLMENT_KEY?.trim() || undefined,
		stateDir: env.SC_STATE_DIR?.trim() || defaultStateDir(),
		policyIntervalMs: int(env, 'SC_POLICY_SYNC_INTERVAL_MS', DEFAULT_POLICY_INTERVAL_MS, 5_000, 24 * 3_600_000),
		eventFlushMs: int(env, 'SC_EVENT_FLUSH_MS', DEFAULT_EVENT_FLUSH_MS, 1_000, 3_600_000),
		eventBatchSize: int(env, 'SC_EVENT_BATCH_SIZE', DEFAULT_EVENT_BATCH_SIZE, 1, 500),
		eventQueueMax: int(env, 'SC_EVENT_QUEUE_MAX', DEFAULT_EVENT_QUEUE_MAX, 1, 1_000_000)
	};
}

function dashboardUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('SC_DASHBOARD_URL must be a URL');
	}
	const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
	if (!ok) throw new Error('SC_DASHBOARD_URL must use https (http is only allowed for localhost)');
	if (url.username || url.password || url.search || url.hash) {
		throw new Error('SC_DASHBOARD_URL must not contain credentials, a query or a fragment');
	}
	return url.origin + url.pathname.replace(/\/+$/, '');
}

function int(env: NodeJS.ProcessEnv, name: string, fallback: number, min: number, max: number): number {
	const raw = env[name];
	if (raw === undefined || raw.trim() === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be an integer from ${min} to ${max}`);
	return n;
}
