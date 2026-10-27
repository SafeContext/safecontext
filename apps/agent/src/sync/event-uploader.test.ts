import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CheckReport } from '../events.ts';
import { memoryLogger } from '../log.ts';
import { CANARY } from '../test-helpers.ts';
import { createDashboardClient } from './dashboard-client.ts';
import { createDeviceAuth } from './device-auth.ts';
import { backoffDelay, createEventUploader } from './event-uploader.ts';
import { ENROLLMENT_KEY, startFakeDashboard, type FakeDashboard } from './fake-dashboard.ts';
import { syncLogger } from './log.ts';
import { memoryTokenStore } from './token-store.ts';

const DEVICE = 'dev-events-test';
let dash: FakeDashboard;
beforeEach(async () => {
	dash = await startFakeDashboard();
});
afterEach(() => dash.close());

const report = (overrides: Partial<CheckReport> = {}): CheckReport => ({
	ts: new Date().toISOString(),
	policyVersion: 1,
	hookEvent: 'PostToolUse',
	toolName: 'Read',
	counts: { 'api-keys': 1 },
	actions: { block: 1 },
	blocked: true,
	latencyMs: 2.5,
	...overrides
});

function setup(opts: { batchSize?: number; maxQueue?: number } = {}) {
	const logger = memoryLogger();
	const auth = createDeviceAuth({
		client: createDashboardClient({ baseUrl: dash.url, timeoutMs: 2_000 }),
		store: memoryTokenStore(),
		deviceId: DEVICE,
		enrollmentKey: ENROLLMENT_KEY,
		logger: syncLogger(logger)
	});
	const uploader = createEventUploader({
		client: createDashboardClient({ baseUrl: dash.url, timeoutMs: 2_000 }),
		auth,
		logger: syncLogger(logger),
		batchSize: opts.batchSize ?? 100,
		flushIntervalMs: 60_000,
		maxQueue: opts.maxQueue ?? 1_000,
		backoffBaseMs: 5,
		backoffMaxMs: 20,
		random: () => 1
	});
	return { uploader, logger };
}

const sent = () => dash.batches.flat();

describe('createEventUploader', () => {
	it('adds the device id and uploads in batches', async () => {
		const { uploader } = setup({ batchSize: 2 });
		for (let i = 0; i < 5; i++) uploader.record(report({ latencyMs: i }));
		await vi.waitFor(() => expect(sent()).toHaveLength(5));
		expect(dash.batches.map((b) => b.length)).toEqual([2, 2, 1]);
		expect(sent().every((e) => e.deviceId === DEVICE)).toBe(true);
		expect(sent().map((e) => e.latencyMs)).toEqual([0, 1, 2, 3, 4]);
		expect(uploader.pending).toBe(0);
	});

	it('never sends text: an event with an extra field is dropped, not uploaded', async () => {
		const { uploader, logger } = setup();
		uploader.record({ ...report(), prompt: CANARY } as CheckReport);
		uploader.record(report({ toolName: `bad name ${CANARY}` }));
		uploader.record(report());
		await uploader.flush();
		expect(sent()).toHaveLength(1);
		expect(dash.rawEventBodies.join('')).not.toContain(CANARY);
		expect(JSON.stringify(logger.records)).not.toContain(CANARY);
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'invalid_event', events: 2 });
	});

	it('retries server errors with backoff, keeping order', async () => {
		dash.override.set('/api/events', [{ status: 503 }, { status: 502 }]);
		const { uploader, logger } = setup();
		uploader.record(report({ latencyMs: 1 }));
		uploader.record(report({ latencyMs: 2 }));
		await uploader.flush();
		expect(sent()).toHaveLength(0);
		expect(uploader.pending).toBe(2);
		await vi.waitFor(() => expect(sent().map((e) => e.latencyMs)).toEqual([1, 2]));
		const failures = logger.records.filter((r) => r.msg === ('events_upload_failed' as never));
		expect(failures.map((r) => (r as { retryInMs?: number }).retryInMs)).toEqual([5, 10]);
	});

	it('respects Retry-After on 429', async () => {
		dash.override.set('/api/events', [
			{ status: 429, headers: { 'retry-after': '1' }, body: { error: { code: 'rate_limited', message: 'x' } } }
		]);
		const { uploader, logger } = setup();
		uploader.record(report());
		await uploader.flush();
		expect(logger.records).toContainEqual(
			expect.objectContaining({ msg: 'events_upload_failed', reason: 'rate_limited', status: 429, retryInMs: 1000 })
		);
		await uploader.flush(); // Still waiting: nothing sent.
		expect(dash.requests.filter((r) => r.path === '/api/events')).toHaveLength(1);
		await vi.waitFor(() => expect(sent()).toHaveLength(1), { timeout: 3_000 });
	});

	it('registers again on 401 and resends', async () => {
		const { uploader } = setup();
		uploader.record(report());
		await uploader.flush();
		dash.tokens.clear();
		uploader.record(report());
		await uploader.flush();
		await vi.waitFor(() => expect(sent()).toHaveLength(2));
		expect(dash.registrations).toBe(2);
	});

	it('drops a batch the dashboard refuses as invalid, and splits one that is too large', async () => {
		dash.override.set('/api/events', [
			{ status: 422, body: { error: { code: 'invalid_body', message: 'x' } } },
			{ status: 413, body: { error: { code: 'bad_request', message: 'x' } } }
		]);
		const { uploader, logger } = setup({ batchSize: 4 });
		uploader.record(report());
		await uploader.flush();
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'rejected', events: 1 });
		for (let i = 0; i < 4; i++) uploader.record(report());
		await vi.waitFor(() => expect(sent()).toHaveLength(4));
		expect(dash.batches.map((b) => b.length)).toEqual([2, 2]);
	});

	it('drops the oldest events when the queue is full', async () => {
		await dash.close();
		const { uploader, logger } = setup({ maxQueue: 3, batchSize: 100 });
		for (let i = 0; i < 5; i++) uploader.record(report({ latencyMs: i }));
		expect(uploader.pending).toBe(3);
		await uploader.close();
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'queue_full', events: 2 });
		expect(logger.records).toContainEqual({ level: 'warn', msg: 'events_dropped', reason: 'shutdown', events: 3 });
	});

	it('sends what is queued on close', async () => {
		const { uploader } = setup();
		uploader.record(report());
		await uploader.close();
		expect(sent()).toHaveLength(1);
	});
});

describe('backoffDelay', () => {
	it('doubles up to the cap, with jitter between 50% and 100%', () => {
		expect([0, 1, 2, 3, 10].map((a) => backoffDelay(a, 1_000, 5_000, () => 1))).toEqual([
			1_000, 2_000, 4_000, 5_000, 5_000
		]);
		expect(backoffDelay(1, 1_000, 5_000, () => 0)).toBe(1_000);
	});
});
