/**
 * Dashboard sync (issue #22): device registration, policy pull and event upload, wired together.
 */
import { join } from 'node:path';
import type { Logger } from '../log.ts';
import type { PolicySource } from '../policy-source.ts';
import type { SyncConfig } from './config.ts';
import { createDashboardClient, type DashboardClient } from './dashboard-client.ts';
import { createDeviceAuth } from './device-auth.ts';
import { createEventUploader, type EventUploader } from './event-uploader.ts';
import { syncLogger } from './log.ts';
import { syncingPolicySource, type SyncingPolicySource } from './policy-sync.ts';
import { loadOrCreateDeviceId, newDeviceId, POLICY_CACHE_FILE } from './state-files.ts';
import { KEYCHAIN_SERVICE, keychainTokenStore, memoryTokenStore, type TokenStore } from './token-store.ts';

export { readSyncConfig, type SyncConfig } from './config.ts';

export interface Sync {
	policy: SyncingPolicySource;
	events: EventUploader;
	close(): Promise<void>;
}

export interface SyncDeps {
	logger: Logger;
	/** Policy to use until the cache or the dashboard has one. */
	fallback: PolicySource;
	/** Defaults to the macOS Keychain (in memory on other platforms). */
	tokenStore?: TokenStore;
	client?: DashboardClient;
}

/** Load the cached policy, then start pulling the policy and uploading events in the background. */
export function startSync(config: SyncConfig, deps: SyncDeps): Sync {
	const logger = syncLogger(deps.logger);
	const client = deps.client ?? createDashboardClient({ baseUrl: config.dashboardUrl });
	const store = deps.tokenStore ?? defaultTokenStore(config, logger);
	const auth = createDeviceAuth({
		client,
		store,
		deviceId: deviceIdOrTemporary(config.stateDir, logger),
		enrollmentKey: config.enrollmentKey,
		logger
	});
	const policy = syncingPolicySource({
		client,
		auth,
		cacheFile: join(config.stateDir, POLICY_CACHE_FILE),
		fallback: deps.fallback,
		intervalMs: config.policyIntervalMs,
		logger
	});
	const events = createEventUploader({
		client,
		auth,
		logger,
		batchSize: config.eventBatchSize,
		flushIntervalMs: config.eventFlushMs,
		maxQueue: config.eventQueueMax
	});
	policy.start();
	events.start();
	return {
		policy,
		events,
		async close() {
			policy.close();
			await events.close();
		}
	};
}

/**
 * The saved device id. If the state folder can't be used (unwritable, read-only disk), sync still
 * runs with an id for this run only rather than stopping the agent; the dashboard then sees this
 * Mac as a new device after each restart until the folder is fixed.
 */
function deviceIdOrTemporary(stateDir: string, logger: ReturnType<typeof syncLogger>): string {
	try {
		return loadOrCreateDeviceId(stateDir);
	} catch {
		logger.log('error', 'state_dir_failed', { reason: 'state_dir' });
		return newDeviceId();
	}
}

function defaultTokenStore(config: SyncConfig, logger: ReturnType<typeof syncLogger>): TokenStore {
	if (process.platform === 'darwin') {
		return keychainTokenStore({ service: KEYCHAIN_SERVICE, account: new URL(config.dashboardUrl).origin });
	}
	// Safe Context targets macOS. Elsewhere (e.g. CI) the token lasts until the agent stops.
	logger.log('warn', 'token_store_failed', { reason: 'keychain' });
	return memoryTokenStore();
}
