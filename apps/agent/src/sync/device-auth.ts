/**
 * The device token: read it from the token store (Keychain), or register the device with the
 * organisation's enrollment key to get one (`POST /api/devices`).
 *
 * The enrollment key is a placeholder for how devices join an org (needs-decision #51).
 * Registering again rotates the token, so only one registration runs at a time.
 */
import type { DashboardClient } from './dashboard-client.ts';
import type { SyncLogger } from './log.ts';
import type { TokenStore } from './token-store.ts';

export interface DeviceAuth {
	readonly deviceId: string;
	/** A token to use, or undefined if there is none and registering failed. Never throws. */
	token(): Promise<string | undefined>;
	/**
	 * The dashboard refused `token` (401, or 403 device mismatch). The next `token()` call
	 * registers again, if there is an enrollment key.
	 */
	rejected(token: string): void;
}

export interface DeviceAuthOptions {
	client: DashboardClient;
	store: TokenStore;
	deviceId: string;
	/** `SC_ENROLLMENT_KEY`. Without it the agent can only use a token already in the store. */
	enrollmentKey: string | undefined;
	logger: SyncLogger;
}

export function createDeviceAuth({ client, store, deviceId, enrollmentKey, logger }: DeviceAuthOptions): DeviceAuth {
	let current: string | undefined;
	/** The last token the dashboard refused: don't use it again even if the store still has it. */
	let rejectedToken: string | undefined;
	let pending: Promise<string | undefined> | undefined;

	async function load(): Promise<string | undefined> {
		try {
			const stored = await store.get();
			if (stored !== undefined && stored !== rejectedToken) return stored;
		} catch {
			logger.log('error', 'token_store_failed', { reason: 'keychain' });
		}
		if (enrollmentKey === undefined) {
			logger.log('warn', 'device_registration_failed', { reason: 'no_enrollment_key' });
			return undefined;
		}
		const result = await client.registerDevice(enrollmentKey, deviceId);
		if (!result.ok) {
			logger.log('warn', 'device_registration_failed', {
				reason: result.reason,
				...('status' in result && { status: result.status })
			});
			return undefined;
		}
		try {
			await store.set(result.token);
		} catch {
			// Still usable for this run; the next start registers again.
			logger.log('error', 'token_store_failed', { reason: 'keychain' });
		}
		logger.log('info', 'device_registered');
		return result.token;
	}

	return {
		deviceId,
		async token() {
			if (current !== undefined) return current;
			pending ??= load().finally(() => (pending = undefined));
			const token = await pending;
			current = token;
			return token;
		},
		rejected(token) {
			if (token !== current) return; // An older token; a newer one is already in use.
			current = undefined;
			rejectedToken = token;
			logger.log('warn', 'device_token_rejected');
		}
	};
}
