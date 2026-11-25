/**
 * The device's id and token: read them from the token store (Keychain), or register the device
 * with the organisation's enrollment key to get them (`POST /api/devices`).
 *
 * The dashboard picks the device id (#51), so each registration is a new device. The id and the
 * token are stored together as one Keychain item, so they can never get out of step. Only one
 * registration runs at a time.
 */
import { Id } from '@safecontext/policy';
import type { DashboardClient } from './dashboard-client.ts';
import type { SyncLogger } from './log.ts';
import type { TokenStore } from './token-store.ts';

export interface DeviceCredentials {
	/** The id the dashboard gave this device (`AgentEvent.deviceId`). */
	deviceId: string;
	token: string;
}

export interface DeviceAuth {
	/** The id and token to use, or undefined if there are none and registering failed. Never throws. */
	credentials(): Promise<DeviceCredentials | undefined>;
	/** Just the token (`credentials()?.token`). */
	token(): Promise<string | undefined>;
	/**
	 * The dashboard refused `token` (401, or 403 device mismatch). The next call registers again,
	 * as a new device, if there is an enrollment key.
	 */
	rejected(token: string): void;
}

export interface DeviceAuthOptions {
	client: DashboardClient;
	store: TokenStore;
	/** `SC_ENROLLMENT_KEY`. Without it the agent can only use credentials already in the store. */
	enrollmentKey: string | undefined;
	/** `SC_DEVICE_LABEL`: sent when registering, so IT can tell this device apart. */
	label?: string | undefined;
	/**
	 * The device id agents before #51 chose themselves and kept in the state folder. A Keychain
	 * item from then holds only the token, which still works with that id.
	 */
	legacyDeviceId?: () => string | undefined;
	logger: SyncLogger;
}

/** How the pair is kept in the store: `<deviceId>.<token>`. Neither contains a dot. */
export function encodeCredentials({ deviceId, token }: DeviceCredentials): string {
	return `${deviceId}.${token}`;
}

/** The pair from a stored value, or undefined if it isn't one (a pre-#51 token needs `legacyId`). */
export function decodeCredentials(value: string, legacyId?: () => string | undefined): DeviceCredentials | undefined {
	const dot = value.indexOf('.');
	if (dot === -1) {
		const deviceId = legacyId?.();
		return deviceId !== undefined && value !== '' ? { deviceId, token: value } : undefined;
	}
	const deviceId = value.slice(0, dot);
	const token = value.slice(dot + 1);
	return Id.safeParse(deviceId).success && token !== '' ? { deviceId, token } : undefined;
}

export function createDeviceAuth({
	client,
	store,
	enrollmentKey,
	label,
	legacyDeviceId,
	logger
}: DeviceAuthOptions): DeviceAuth {
	let current: DeviceCredentials | undefined;
	/** The last token the dashboard refused: don't use it again even if the store still has it. */
	let rejectedToken: string | undefined;
	let pending: Promise<DeviceCredentials | undefined> | undefined;

	async function load(): Promise<DeviceCredentials | undefined> {
		try {
			const raw = await store.get();
			const stored = raw === undefined ? undefined : decodeCredentials(raw, legacyDeviceId);
			if (stored !== undefined && stored.token !== rejectedToken) return stored;
		} catch {
			logger.log('error', 'token_store_failed', { reason: 'keychain' });
		}
		if (enrollmentKey === undefined) {
			logger.log('warn', 'device_registration_failed', { reason: 'no_enrollment_key' });
			return undefined;
		}
		const result = await client.registerDevice(enrollmentKey, label);
		if (!result.ok) {
			logger.log('warn', 'device_registration_failed', {
				reason: result.reason,
				...('status' in result && { status: result.status })
			});
			return undefined;
		}
		const fresh = { deviceId: result.deviceId, token: result.token };
		try {
			await store.set(encodeCredentials(fresh));
		} catch {
			// Still usable for this run; the next start registers again, as a new device.
			logger.log('error', 'token_store_failed', { reason: 'keychain' });
		}
		logger.log('info', 'device_registered');
		return fresh;
	}

	async function credentials() {
		if (current !== undefined) return current;
		pending ??= load().finally(() => (pending = undefined));
		const loaded = await pending;
		current = loaded;
		return loaded;
	}

	return {
		credentials,
		async token() {
			return (await credentials())?.token;
		},
		rejected(token) {
			if (token !== current?.token) return; // An older token; a newer one is already in use.
			current = undefined;
			rejectedToken = token;
			logger.log('warn', 'device_token_rejected');
		}
	};
}
