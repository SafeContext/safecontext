import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '@safecontext/policy';
import { policyWith } from '../test-helpers.ts';
import { createDashboardClient, parseRetryAfter, type DashboardClient } from './dashboard-client.ts';
import { ENROLLMENT_KEY, startFakeDashboard, type FakeDashboard } from './fake-dashboard.ts';

const DEVICE = 'dev-test';
const event = (overrides: Partial<AgentEvent> = {}): AgentEvent => ({
	ts: '2026-10-27T12:00:00.000Z',
	deviceId: DEVICE,
	policyVersion: 1,
	hookEvent: 'UserPromptSubmit',
	counts: {},
	actions: {},
	blocked: false,
	latencyMs: 1,
	...overrides
});

let dash: FakeDashboard;
let client: DashboardClient;
beforeEach(async () => {
	dash = await startFakeDashboard();
	client = createDashboardClient({ baseUrl: dash.url, timeoutMs: 2_000 });
});
afterEach(() => dash.close());

describe('registerDevice', () => {
	it('returns a token with the enrollment key', async () => {
		const result = await client.registerDevice(ENROLLMENT_KEY, DEVICE);
		expect(result).toEqual({ ok: true, token: expect.stringMatching(/^scd_/) });
		expect(dash.requests[0]).toMatchObject({ method: 'POST', path: '/api/devices', auth: ENROLLMENT_KEY });
	});

	it('reports a wrong enrollment key', async () => {
		expect(await client.registerDevice('sce_wrong', DEVICE)).toEqual({
			ok: false,
			reason: 'unauthorized',
			status: 401
		});
	});

	it('rejects a response for a different device', async () => {
		dash.override.set('/api/devices', [{ status: 201, body: { deviceId: 'dev-other', token: 'scd_x' } }]);
		expect(await client.registerDevice(ENROLLMENT_KEY, DEVICE)).toMatchObject({ ok: false, reason: 'bad_response' });
	});
});

describe('getPolicy', () => {
	it('returns the policy and ETag, then 304 with If-None-Match', async () => {
		const token = dash.issueToken(DEVICE);
		dash.policy = policyWith({ version: 3 });
		const first = await client.getPolicy(token);
		expect(first).toMatchObject({ ok: true, status: 200, etag: '"policy-v3"', policy: { version: 3 } });
		expect(await client.getPolicy(token, '"policy-v3"')).toEqual({ ok: true, status: 304 });
		expect(dash.requests[1]).toMatchObject({ path: '/api/policy', ifNoneMatch: '"policy-v3"', auth: token });
	});

	it('reports no_policy, 401, 429 with Retry-After, 5xx and an invalid policy', async () => {
		const token = dash.issueToken(DEVICE);
		expect(await client.getPolicy(token)).toEqual({ ok: false, reason: 'no_policy', status: 404 });
		expect(await client.getPolicy('scd_nope')).toEqual({ ok: false, reason: 'unauthorized', status: 401 });
		dash.override.set('/api/policy', [
			{ status: 429, headers: { 'retry-after': '7' }, body: { error: { code: 'rate_limited', message: 'x' } } },
			{ status: 503 },
			{ status: 200, body: { version: -1 } }
		]);
		expect(await client.getPolicy(token)).toEqual({
			ok: false,
			reason: 'rate_limited',
			status: 429,
			retryAfterMs: 7000
		});
		expect(await client.getPolicy(token)).toEqual({ ok: false, reason: 'server_error', status: 503 });
		expect(await client.getPolicy(token)).toEqual({ ok: false, reason: 'bad_response', status: 200 });
	});

	it('reports a dashboard that is down', async () => {
		await dash.close();
		expect(await client.getPolicy('scd_x')).toEqual({ ok: false, reason: 'network' });
	});

	it('keeps a path prefix in the base URL', async () => {
		const seen: string[] = [];
		const prefixed = createDashboardClient({
			baseUrl: 'https://example.com/sc/',
			fetch: async (url) => {
				seen.push(String(url));
				return new Response(null, { status: 304 });
			}
		});
		await prefixed.getPolicy('scd_x');
		expect(seen).toEqual(['https://example.com/sc/api/policy']);
	});
});

describe('postEvents', () => {
	it('uploads a batch', async () => {
		const token = dash.issueToken(DEVICE);
		expect(await client.postEvents(token, [event(), event({ blocked: true })])).toEqual({ ok: true, accepted: 2 });
		expect(dash.batches).toHaveLength(1);
	});

	it('reports device_mismatch and refuses invalid batches before sending', async () => {
		const token = dash.issueToken(DEVICE);
		expect(await client.postEvents(token, [event({ deviceId: 'dev-other' })])).toEqual({
			ok: false,
			reason: 'device_mismatch',
			status: 403
		});
		const before = dash.requests.length;
		expect(await client.postEvents(token, [])).toEqual({ ok: false, reason: 'rejected', status: 0 });
		expect(dash.requests.length).toBe(before);
	});

	it('reports 413, and other 4xx as rejected with the error code', async () => {
		const token = dash.issueToken(DEVICE);
		dash.override.set('/api/events', [
			{ status: 413, body: { error: { code: 'bad_request', message: 'x' } } },
			{ status: 422, body: { error: { code: 'invalid_body', message: 'x' } } }
		]);
		expect(await client.postEvents(token, [event()])).toEqual({ ok: false, reason: 'too_large', status: 413 });
		expect(await client.postEvents(token, [event()])).toEqual({
			ok: false,
			reason: 'rejected',
			status: 422,
			code: 'invalid_body'
		});
	});
});

describe('parseRetryAfter', () => {
	it('reads seconds and HTTP dates', () => {
		const now = Date.parse('2026-10-27T12:00:00Z');
		expect(parseRetryAfter('3', now)).toBe(3000);
		expect(parseRetryAfter('Tue, 27 Oct 2026 12:00:10 GMT', now)).toBe(10_000);
		expect(parseRetryAfter('Tue, 27 Oct 2026 11:00:00 GMT', now)).toBe(0);
		expect(parseRetryAfter(null)).toBeUndefined();
		expect(parseRetryAfter('soon')).toBeUndefined();
	});
});
