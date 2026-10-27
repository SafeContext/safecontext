import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryLogger } from '../log.ts';
import { createDashboardClient } from './dashboard-client.ts';
import { createDeviceAuth } from './device-auth.ts';
import { ENROLLMENT_KEY, startFakeDashboard, type FakeDashboard } from './fake-dashboard.ts';
import { syncLogger } from './log.ts';
import { memoryTokenStore, type TokenStore } from './token-store.ts';

const DEVICE = 'dev-auth-test';
let dash: FakeDashboard;
beforeEach(async () => {
	dash = await startFakeDashboard();
});
afterEach(() => dash.close());

function setup(
	store = memoryTokenStore(),
	{ enrollmentKey }: { enrollmentKey?: string } = { enrollmentKey: ENROLLMENT_KEY }
) {
	const logger = memoryLogger();
	const auth = createDeviceAuth({
		client: createDashboardClient({ baseUrl: dash.url }),
		store,
		deviceId: DEVICE,
		enrollmentKey,
		logger: syncLogger(logger)
	});
	return { auth, store, logger };
}

describe('createDeviceAuth', () => {
	it('uses the stored token without registering', async () => {
		const token = dash.issueToken(DEVICE);
		const { auth } = setup(memoryTokenStore(token));
		expect(await auth.token()).toBe(token);
		expect(dash.registrations).toBe(0);
	});

	it('registers once, even when asked concurrently, and stores the token', async () => {
		const { auth, store, logger } = setup();
		const tokens = await Promise.all([auth.token(), auth.token(), auth.token()]);
		expect(new Set(tokens).size).toBe(1);
		expect(dash.registrations).toBe(1);
		expect(store.value).toBe(tokens[0]);
		expect(logger.records).toContainEqual({ level: 'info', msg: 'device_registered' });
	});

	it('registers again after the dashboard rejects the token', async () => {
		const { auth, store } = setup(memoryTokenStore('scd_revoked'));
		const old = await auth.token();
		auth.rejected(old!);
		const fresh = await auth.token();
		expect(fresh).not.toBe('scd_revoked');
		expect(store.value).toBe(fresh);
		expect(dash.registrations).toBe(1);
	});

	it('ignores a rejection of a token that is no longer current', async () => {
		const { auth } = setup();
		const token = await auth.token();
		auth.rejected('scd_older');
		expect(await auth.token()).toBe(token);
		expect(dash.registrations).toBe(1);
	});

	it('has no token without an enrollment key or a stored token, and says why', async () => {
		const { auth, logger } = setup(memoryTokenStore(), {});
		expect(await auth.token()).toBeUndefined();
		expect(logger.records).toContainEqual({
			level: 'warn',
			msg: 'device_registration_failed',
			reason: 'no_enrollment_key'
		});
	});

	it('still registers if the Keychain fails, and never logs a secret', async () => {
		const broken: TokenStore = {
			kind: 'keychain',
			get: () => Promise.reject(new Error('locked')),
			set: () => Promise.reject(new Error('locked')),
			delete: () => Promise.resolve()
		};
		const { auth, logger } = setup(broken as never);
		const token = await auth.token();
		expect(token).toMatch(/^scd_/);
		const logged = JSON.stringify(logger.records);
		expect(logged).toContain('token_store_failed');
		expect(logged).not.toContain(token!);
		expect(logged).not.toContain(ENROLLMENT_KEY);
	});
});
