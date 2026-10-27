/**
 * Log messages and fields for dashboard sync. Same rules as `../log.ts`: metadata only, never
 * prompt or tool text, and never the device token or the enrollment key. This is a closed list
 * kept next to the sync code so the main `LogMessage` list in `../log.ts` stays untouched.
 */
import type { Logger, LogLevel } from '../log.ts';

export type SyncLogMessage =
	| 'sync_started'
	| 'device_registered'
	| 'device_registration_failed'
	| 'device_token_rejected'
	| 'token_store_failed'
	| 'policy_cache_loaded'
	| 'policy_cache_invalid'
	| 'policy_cache_write_failed'
	| 'policy_synced'
	| 'policy_unchanged'
	| 'policy_stale'
	| 'policy_sync_failed'
	| 'events_uploaded'
	| 'events_upload_failed'
	| 'events_dropped';

/** Why a sync step failed or events were dropped. A fixed set of codes, not free text. */
export type SyncReason =
	| 'network'
	| 'timeout'
	| 'server_error'
	| 'unauthorized'
	| 'device_mismatch'
	| 'rate_limited'
	| 'rejected'
	| 'too_large'
	| 'bad_response'
	| 'invalid_policy'
	| 'no_policy'
	| 'no_token'
	| 'no_enrollment_key'
	| 'invalid_event'
	| 'queue_full'
	| 'shutdown'
	| 'keychain'
	| 'missing'
	| 'unreadable'
	| 'not_json'
	| 'invalid';

export interface SyncLogFields {
	policyVersion?: number;
	policySource?: 'dashboard' | 'cache' | 'file' | 'default' | 'static';
	reason?: SyncReason;
	/** HTTP status from the dashboard. */
	status?: number;
	/** Number of events. */
	events?: number;
	/** Next attempt in ms. */
	retryInMs?: number;
	/** Policy pull interval in ms. */
	intervalMs?: number;
	/** Zod issue count. */
	issues?: number;
}

export interface SyncLogger {
	log(level: LogLevel, msg: SyncLogMessage, fields?: SyncLogFields): void;
}

/** Log sync messages through the agent's logger. Every logger accepts any message at run time. */
export function syncLogger(logger: Logger): SyncLogger {
	return logger as unknown as SyncLogger;
}
