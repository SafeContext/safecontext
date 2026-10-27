import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { createClassifier } from '../classifier/classifier.ts';
import { createTier0 } from '../classifier/tier0.ts';
import { memoryLogger } from '../log.ts';
import { staticPolicySource } from '../policy-source.ts';
import { CANARY, policyWith, SECRET } from '../test-helpers.ts';
import { readSyncConfig } from './config.ts';
import { ENROLLMENT_KEY, startFakeDashboard, type FakeDashboard } from './fake-dashboard.ts';
import { startSync, type Sync } from './index.ts';
import { DEVICE_ID_FILE } from './state-files.ts';
import { memoryTokenStore } from './token-store.ts';

let dash: FakeDashboard;
let dir: string;
let sync: Sync | undefined;
beforeEach(async () => {
	dash = await startFakeDashboard();
	dir = mkdtempSync(join(tmpdir(), 'sc-agent-sync-e2e-'));
});
afterEach(async () => {
	await sync?.close();
	sync = undefined;
	await dash.close();
	rmSync(dir, { recursive: true, force: true });
});

describe('startSync with the agent app', () => {
	it('registers, enforces the dashboard policy and uploads text-free events', async () => {
		dash.policy = policyWith({ version: 9, failMode: 'allow' });
		const logger = memoryLogger();
		const store = memoryTokenStore();
		const config = readSyncConfig({
			SC_DASHBOARD_URL: dash.url,
			SC_ENROLLMENT_KEY: ENROLLMENT_KEY,
			SC_STATE_DIR: dir,
			SC_POLICY_SYNC_INTERVAL_MS: '5000',
			SC_EVENT_FLUSH_MS: '1000',
			SC_EVENT_BATCH_SIZE: '1'
		})!;
		sync = startSync(config, {
			logger,
			fallback: staticPolicySource(policyWith({ version: 0 }), 'default'),
			tokenStore: store
		});
		const app = createApp({
			policy: sync.policy,
			classifier: createClassifier({ tiers: [createTier0()], budgetMs: 1_000 }),
			logger,
			events: sync.events
		});

		await vi.waitFor(async () => {
			const health = await (await app.request('/health')).json();
			expect(health.policyVersion).toBe(9);
		});

		const deviceId = readFileSync(join(dir, DEVICE_ID_FILE), 'utf8').trim();
		expect(deviceId).toMatch(/^dev-[0-9a-f]{32}$/);
		expect(store.value).toMatch(/^scd_/);

		const res = await app.request('/v1/prompt', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				session_id: 's1',
				transcript_path: '/tmp/t.jsonl',
				cwd: '/tmp',
				hook_event_name: 'UserPromptSubmit',
				prompt: `${CANARY} ${SECRET}`
			})
		});
		expect(res.status).toBe(200);

		await vi.waitFor(() => expect(dash.batches.flat()).toHaveLength(1));
		const [event] = dash.batches.flat();
		expect(event).toMatchObject({ deviceId, policyVersion: 9, hookEvent: 'UserPromptSubmit', blocked: true });
		const everything = dash.rawEventBodies.join('') + JSON.stringify(logger.records);
		expect(everything).not.toContain(CANARY);
		expect(everything).not.toContain(SECRET);
		expect(everything).not.toContain(store.value!);
		expect(everything).not.toContain(ENROLLMENT_KEY);
	});
});
