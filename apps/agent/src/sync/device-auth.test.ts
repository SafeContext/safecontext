import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memoryLogger } from '../log.ts';
import { createDashboardClient } from './dashboard-client.ts';
import { createDeviceAuth, decodeCredentials, encodeCredentials } from './device-auth.ts';
import { ENROLLMENT_KEY, startFakeDashboard, type FakeDashboard } from './fake-dashboard.ts';
import { syncLogger } from './log.ts';
import { memoryTokenStore, type TokenStore } from './token-store.ts';

const DEVICE = 'dev-auth-test';
const pair = (token: string, deviceId = DEVICE) => encodeCredentials({ deviceId, token });
let dash: FakeDashboard;
beforeEach(async () => {
	dash = await startFakeDashboard();
});
afterEach(() => dash.close());

function setup(
	store = memoryTokenStore(),
	{
		enrollmentKey,
		label,
		legacyId
	}: { enrollmentKey?: string; label?: string; legacyId?: string } = { enrollmentKey: ENROLLMENT_KEY }
) {
	const logger = memoryLogger();
	const auth = createDeviceAuth({
		client: createDashboardClient({ baseUrl: dash.url }),
		store,
		enrollmentKey,
		label,
		legacyDeviceId: () => legacyId,
		logger: syncLogger(logger)
	});
	return { auth, store, logger };
}

describe('createDeviceAuth', () => {
	it('uses the stored id and token without registering', async () => {
		const token = dash.issueToken(DEVICE);
		const { auth } = setup(memoryTokenStore(pair(token)));
		expect(await auth.credentials()).toEqual({ deviceId: DEVICE, token });
		expect(dash.registrations).toBe(0);
	});

	it("keeps a pre-#51 token working with the id from the state folder", async () => {
		const token = dash.issueToken('dev-chosen-by-agent');
		const { auth } = setup(memoryTokenStore(token), { enrollmentKey: ENROLLMENT_KEY, legacyId: 'dev-chosen-by-agent' });
		expect(await auth.credentials()).toEqual({ deviceId: 'dev-chosen-by-agent', token });
		expect(dash.registrations).toBe(0);
	});

	it('registers as a new device when a pre-#51 token has no id to go with it', async () => {
		const { auth, store } = setup(memoryTokenStore('scd_orphan'));
		const creds = await auth.credentials();
		expect(creds?.deviceId).toBe('dev-fake1');
		expect(store.value).toBe(pair(creds!.token, 'dev-fake1'));
	});

	it('reads only well-formed stored values', () => {
		expect(decodeCredentials('dev-a.scd_x')).toEqual({ deviceId: 'dev-a', token: 'scd_x' });
		expect(decodeCredentials('Dev A.scd_x')).toBeUndefined();
		expect(decodeCredentials('dev-a.')).toBeUndefined();
		expect(decodeCredentials('scd_x')).toBeUndefined();
		expect(decodeCredentials('scd_x', () => 'dev-old')).toEqual({ deviceId: 'dev-old', token: 'scd_x' });
	});

	it('takes the id the dashboard picked, sends the label, and stores both together (#51)', async () => {
		const { auth, store } = setup(memoryTokenStore(), { enrollmentKey: ENROLLMENT_KEY, label: 'Asset 1042' });
		const creds = await auth.credentials();
		expect(creds).toEqual({ deviceId: 'dev-fake1', token: expect.stringMatching(/^scd_/) });
		expect(store.value).toBe(pair(creds!.token, 'dev-fake1'));
		expect(dash.labels).toEqual(['Asset 1042']);
	});

	it('registers once, even when asked concurrently, and stores the token', async () => {
		const { auth, store, logger } = setup();
		const tokens = await Promise.all([auth.token(), auth.token(), auth.token()]);
		expect(new Set(tokens).size).toBe(1);
		expect(dash.registrations).toBe(1);
		expect(store.value).toBe(pair(tokens[0]!, 'dev-fake1'));
		expect(logger.records).toContainEqual({ level: 'info', msg: 'device_registered' });
	});

	it('registers again, as a new device, after the dashboard rejects the token', async () => {
		const { auth, store } = setup(memoryTokenStore(pair('scd_revoked')));
		const old = await auth.token();
		auth.rejected(old!);
		const fresh = await auth.credentials();
		expect(fresh).toEqual({ deviceId: 'dev-fake1', token: expect.not.stringMatching('scd_revoked') });
		expect(store.value).toBe(pair(fresh!.token, 'dev-fake1'));
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
