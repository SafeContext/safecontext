import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryLogger } from '../log.ts';
import { staticPolicySource } from '../policy-source.ts';
import { policyWith } from '../test-helpers.ts';
import { createDashboardClient } from './dashboard-client.ts';
import { createDeviceAuth } from './device-auth.ts';
import { ENROLLMENT_KEY, startFakeDashboard, type FakeDashboard } from './fake-dashboard.ts';
import { syncLogger } from './log.ts';
import { syncingPolicySource } from './policy-sync.ts';
import { POLICY_CACHE_FILE } from './state-files.ts';
import { memoryTokenStore } from './token-store.ts';

const DEVICE = 'dev-policy-test';
let dash: FakeDashboard;
let dir: string;
beforeEach(async () => {
	dash = await startFakeDashboard();
	dir = mkdtempSync(join(tmpdir(), 'sc-agent-sync-'));
});
afterEach(async () => {
	await dash.close();
	rmSync(dir, { recursive: true, force: true });
});

const fallbackPolicy = policyWith({ version: 0 });

function source({ intervalMs = 60_000, url = dash.url } = {}) {
	const logger = memoryLogger();
	const client = createDashboardClient({ baseUrl: url, timeoutMs: 2_000 });
	const auth = createDeviceAuth({
		client,
		store: memoryTokenStore(),
		deviceId: DEVICE,
		enrollmentKey: ENROLLMENT_KEY,
		logger: syncLogger(logger)
	});
	const policy = syncingPolicySource({
		client,
		auth,
		cacheFile: join(dir, POLICY_CACHE_FILE),
		fallback: staticPolicySource(fallbackPolicy, 'default'),
		intervalMs,
		logger: syncLogger(logger)
	});
	return { policy, logger };
}

describe('syncingPolicySource', () => {
	it('uses the fallback until the first pull, then the dashboard policy, cached to disk', async () => {
		dash.policy = policyWith({ version: 4, failMode: 'allow' });
		const { policy, logger } = source();
		expect(policy.kind).toBe('default');
		expect(policy.current()).toBe(fallbackPolicy);

		expect(await policy.refresh()).toBe('updated');
		expect(policy.kind).toBe('dashboard');
		expect(policy.current()).toMatchObject({ version: 4, failMode: 'allow' });
		expect(logger.records).toContainEqual({
			level: 'info',
			msg: 'policy_synced',
			policySource: 'dashboard',
			policyVersion: 4
		});

		const cachePath = join(dir, POLICY_CACHE_FILE);
		const cache = JSON.parse(readFileSync(cachePath, 'utf8'));
		expect(cache).toMatchObject({ etag: '"policy-v4"', policy: { version: 4 } });
		expect(statSync(cachePath).mode & 0o777).toBe(0o600);
	});

	it('sends the ETag back and handles 304', async () => {
		dash.policy = policyWith({ version: 2 });
		const { policy } = source();
		await policy.refresh();
		expect(await policy.refresh()).toBe('unchanged');
		expect(dash.requests.filter((r) => r.path === '/api/policy').at(-1)?.ifNoneMatch).toBe('"policy-v2"');
		expect(policy.current().version).toBe(2);
	});

	it('picks up a published change within one interval', async () => {
		dash.policy = policyWith({ version: 1 });
		const { policy } = source({ intervalMs: 25 });
		policy.start();
		try {
			await vi.waitFor(() => expect(policy.current().version).toBe(1), { timeout: 2_000 });
			dash.policy = policyWith({ version: 2, failMode: 'allow' });
			const published = Date.now();
			await vi.waitFor(() => expect(policy.current().version).toBe(2), { timeout: 2_000, interval: 5 });
			expect(Date.now() - published).toBeLessThan(1_000);
		} finally {
			policy.close();
		}
	});

	it('works offline from the cache after a restart', async () => {
		dash.policy = policyWith({ version: 7 });
		await source().policy.refresh();
		await dash.close();

		const { policy, logger } = source();
		expect(policy.kind).toBe('cache');
		expect(policy.current().version).toBe(7);
		expect(await policy.refresh()).toBe('failed');
		expect(policy.current().version).toBe(7);
		expect(logger.records).toContainEqual(
			expect.objectContaining({ level: 'warn', msg: 'device_registration_failed', reason: 'network' })
		);
	});

	it('keeps the current policy when the dashboard goes down or has none, logging only changes', async () => {
		const { policy, logger } = source();
		expect(await policy.refresh()).toBe('no_policy');
		expect(await policy.refresh()).toBe('no_policy');
		expect(policy.current()).toBe(fallbackPolicy);
		expect(logger.records.filter((r) => r.msg === ('policy_sync_failed' as never))).toHaveLength(1);

		dash.policy = policyWith({ version: 3 });
		await policy.refresh();
		dash.override.set('/api/policy', [{ status: 500 }, { status: 500 }]);
		expect(await policy.refresh()).toBe('failed');
		expect(await policy.refresh()).toBe('failed');
		expect(policy.current().version).toBe(3);
	});

	it('ignores an older version than the one it has', async () => {
		dash.policy = policyWith({ version: 5 });
		const { policy } = source();
		await policy.refresh();
		dash.policy = policyWith({ version: 4 });
		expect(await policy.refresh()).toBe('stale');
		expect(policy.current().version).toBe(5);
	});

	it('ignores a corrupt cache file', () => {
		writeFileSync(join(dir, POLICY_CACHE_FILE), '{ nope');
		const { policy, logger } = source();
		expect(policy.kind).toBe('default');
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'policy_cache_invalid', reason: 'not_json' });
	});

	it('registers again when the token is revoked', async () => {
		dash.policy = policyWith({ version: 1 });
		const { policy } = source();
		await policy.refresh();
		dash.tokens.clear();
		expect(await policy.refresh()).toBe('failed');
		dash.policy = policyWith({ version: 2 });
		expect(await policy.refresh()).toBe('updated');
		expect(dash.registrations).toBe(2);
	});

	it('waits at least Retry-After after a 429', async () => {
		dash.policy = policyWith({ version: 1 });
		const { policy } = source({ intervalMs: 10 });
		dash.override.set('/api/policy', [
			{ status: 429, headers: { 'retry-after': '1' }, body: { error: { code: 'rate_limited', message: 'x' } } }
		]);
		const started = Date.now();
		policy.start();
		try {
			await vi.waitFor(() => expect(policy.current().version).toBe(1), { timeout: 3_000, interval: 10 });
			expect(Date.now() - started).toBeGreaterThanOrEqual(950);
		} finally {
			policy.close();
		}
	});
});
