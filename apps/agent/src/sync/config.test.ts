import { describe, expect, it } from 'vitest';
import { readConfig } from '../config.ts';
import { defaultStateDir, readSyncConfig } from './config.ts';

describe('readSyncConfig', () => {
	it('is off without SC_DASHBOARD_URL, so the agent keeps the file/default behaviour', () => {
		expect(readSyncConfig({})).toBeUndefined();
		expect(readSyncConfig({ SC_DASHBOARD_URL: '  ' })).toBeUndefined();
		expect(readConfig({}).sync).toBeUndefined();
	});

	it('has defaults', () => {
		expect(readSyncConfig({ SC_DASHBOARD_URL: 'https://dash.example.com/' })).toEqual({
			dashboardUrl: 'https://dash.example.com',
			enrollmentKey: undefined,
			stateDir: defaultStateDir(),
			policyIntervalMs: 30_000,
			eventFlushMs: 5_000,
			eventBatchSize: 100,
			eventQueueMax: 5_000
		});
		expect(defaultStateDir('/Users/x')).toBe('/Users/x/Library/Application Support/SafeContext');
	});

	it('reads the env and keeps a path prefix', () => {
		expect(
			readSyncConfig({
				SC_DASHBOARD_URL: 'https://example.com/safecontext/',
				SC_ENROLLMENT_KEY: 'sce_x',
				SC_STATE_DIR: '/tmp/sc',
				SC_POLICY_SYNC_INTERVAL_MS: '10000',
				SC_EVENT_FLUSH_MS: '2000',
				SC_EVENT_BATCH_SIZE: '500',
				SC_EVENT_QUEUE_MAX: '10'
			})
		).toEqual({
			dashboardUrl: 'https://example.com/safecontext',
			enrollmentKey: 'sce_x',
			stateDir: '/tmp/sc',
			policyIntervalMs: 10_000,
			eventFlushMs: 2_000,
			eventBatchSize: 500,
			eventQueueMax: 10
		});
	});

	it('allows http only on loopback', () => {
		expect(readSyncConfig({ SC_DASHBOARD_URL: 'http://localhost:5173' })?.dashboardUrl).toBe('http://localhost:5173');
		expect(readSyncConfig({ SC_DASHBOARD_URL: 'http://127.0.0.1:5173' })?.dashboardUrl).toBe('http://127.0.0.1:5173');
		expect(() => readSyncConfig({ SC_DASHBOARD_URL: 'http://dash.example.com' })).toThrow(/https/);
		expect(() => readSyncConfig({ SC_DASHBOARD_URL: 'not a url' })).toThrow(/SC_DASHBOARD_URL/);
		expect(() => readSyncConfig({ SC_DASHBOARD_URL: 'https://u:p@dash.example.com' })).toThrow(/credentials/);
	});

	it('rejects bad numbers', () => {
		const url = { SC_DASHBOARD_URL: 'https://dash.example.com' };
		expect(() => readSyncConfig({ ...url, SC_POLICY_SYNC_INTERVAL_MS: '100' })).toThrow(/SC_POLICY_SYNC_INTERVAL_MS/);
		expect(() => readSyncConfig({ ...url, SC_EVENT_BATCH_SIZE: '501' })).toThrow(/SC_EVENT_BATCH_SIZE/);
		expect(() => readSyncConfig({ ...url, SC_EVENT_QUEUE_MAX: 'x' })).toThrow(/SC_EVENT_QUEUE_MAX/);
	});
});
