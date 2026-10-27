/**
 * Real HTTP on an ephemeral port (other test runs may be using 4747), and the issue #9 target:
 * p95 < 50 ms per hook request with tier 0 only.
 */
import { AGENT_API, AGENT_HOST } from '@safecontext/policy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { createClassifier } from './classifier/classifier.ts';
import { createTier0 } from './classifier/tier0.ts';
import { staticPolicySource } from './policy-source.ts';
import { startServer, type RunningServer } from './server.ts';
import { loadFixtures, policyWith, promptInput, SECRET } from './test-helpers.ts';

const P95_TARGET_MS = 50;
const RUNS = 300;

let server: RunningServer;
beforeAll(async () => {
	const app = createApp({
		policy: staticPolicySource(policyWith()),
		classifier: createClassifier({ tiers: [createTier0()], budgetMs: 8_000 })
	});
	server = await startServer(app, 0);
});
afterAll(() => server.close());

const url = (path: string) => `http://${AGENT_HOST}:${server.port}${path}`;
const post = (path: string, body: unknown) =>
	fetch(url(path), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('HTTP server', () => {
	it('binds loopback on the port it was given (0 = any free port)', async () => {
		expect(server.port).toBeGreaterThan(0);
		const res = await fetch(url(AGENT_API.health.path));
		expect(await res.json()).toEqual({ ok: true, policyVersion: 0 });
	});

	it('answers a hook over HTTP with valid hook JSON', async () => {
		const res = await post(AGENT_API.prompt.path, promptInput(`token ${SECRET}`));
		expect(res.status).toBe(200);
		expect(AGENT_API.prompt.response.parse(await res.json()).decision).toBe('block');
	});
});

describe(`latency: p95 < ${P95_TARGET_MS} ms with tier 0 (${RUNS} requests over HTTP)`, () => {
	it('meets the target on a realistic mix of hook calls', async () => {
		const fixtures = loadFixtures().map(([, fx]) => fx);
		const longPrompt = 'Please refactor the order service so retries back off. '.repeat(90); // ~5 KB
		const calls: Array<[string, unknown]> = [
			[AGENT_API.prompt.path, promptInput('Add a unit test for the cart total.')],
			[AGENT_API.prompt.path, promptInput(longPrompt)],
			[AGENT_API.prompt.path, promptInput(`${longPrompt} ${SECRET}`)],
			...fixtures.map((fx): [string, unknown] => [AGENT_API.toolInput.path, fx.preToolUseInput]),
			...fixtures.map((fx): [string, unknown] => [AGENT_API.toolOutput.path, fx.postToolUseInput])
		];

		for (const [path, body] of calls) await (await post(path, body)).arrayBuffer(); // warm up

		const times: number[] = [];
		for (let i = 0; i < RUNS; i++) {
			const [path, body] = calls[i % calls.length]!;
			const t0 = performance.now();
			const res = await post(path, body);
			await res.arrayBuffer();
			times.push(performance.now() - t0);
			expect(res.status).toBe(200);
		}
		times.sort((a, b) => a - b);
		const pct = (p: number) => times[Math.min(times.length - 1, Math.floor(p * times.length))]!;
		console.info(
			`agent latency over HTTP, tier 0: p50 ${pct(0.5).toFixed(2)} ms, p95 ${pct(0.95).toFixed(2)} ms, max ${times.at(-1)!.toFixed(2)} ms`
		);
		expect(pct(0.95)).toBeLessThan(P95_TARGET_MS);
	});
});
