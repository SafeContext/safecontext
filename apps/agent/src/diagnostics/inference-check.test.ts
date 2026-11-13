import { AGENT_API, defaultPolicy } from '@safecontext/policy';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.ts';
import { createClassifier } from '../classifier/classifier.ts';
import { createTier1 } from '../classifier/tier1/tier1.ts';
import type { TaggerModel } from '../classifier/tier1/gliner.ts';
import { tier2FromConfig } from '../classifier/tier2/tier2.ts';
import { PINNED_TIER2_MODEL, PINNED_TIER2_DIGEST, readConfig } from '../config.ts';
import { staticPolicySource } from '../policy-source.ts';
import {
	checkInference,
	smokeTier1,
	parseReference,
	verifyOllamaPin,
	timings,
	inferenceEnvironment,
	type InferenceReference,
	type InferenceDependencies
} from './inference-check.ts';

const revision = '9f176c61140facd874f36ada78b0ea370e896dc2';
const pins = { revision, model: PINNED_TIER2_MODEL, digest: PINNED_TIER2_DIGEST };
const plan = 'Internal plan: Project Heron launches tomorrow.';
const start = plan.indexOf('Project Heron');
const expected = {
	spans: [{ start, end: start + 13, dataTypeId: 'unreleased-roadmap' }],
	prompt: 'block' as const,
	tool: 'rewritten' as const
};
const reference = (): InferenceReference => ({
	schemaVersion: 1,
	revision,
	origin: 'synthetic unit-test fixture; not a real-model baseline',
	cases: [
		{
			text: 'A public guide to installing tools.',
			tier1: { spans: [], prompt: 'allow', tool: 'unchanged' },
			combined: { spans: [], prompt: 'allow', tool: 'unchanged' }
		},
		{ text: plan, tier1: structuredClone(expected), combined: structuredClone(expected) }
	]
});

function setup() {
	const close = vi.fn(async () => {});
	const score = vi.fn(async (promptIds: readonly number[], labelCount: number, words: readonly { text: string }[]) => {
		const labels = String.fromCharCode(...promptIds.map((id) => (id === -1 ? 0 : id)))
			.split('\0')
			.slice(1);
		const index = labels.indexOf('roadmap');
		const logits = new Float32Array(words.length * 2 * labelCount).fill(-10);
		for (let i = 0; i + 1 < words.length; i++)
			if (words[i]!.text === 'Project' && words[i + 1]!.text === 'Heron' && index >= 0)
				logits[(i * 2 + 1) * labelCount + index] = 5;
		return logits;
	});
	const model: TaggerModel = {
		maxWidth: 2,
		maxWords: 64,
		maxTokens: 4096,
		labels: { 'unreleased-roadmap': 'roadmap' },
		tokenize: (text) => [...text].map((c) => c.charCodeAt(0)),
		promptIds: (labels) => labels.flatMap((l) => [-1, ...l.ids]),
		score,
		close
	};
	const chats = vi.fn();
	const fakeFetch: typeof fetch = async (input, init) => {
		if (String(input).endsWith('/api/tags'))
			return Response.json({ models: [{ name: pins.model, digest: pins.digest }] });
		chats();
		const body = JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> };
		const ids = [...body.messages.at(-1)!.content.matchAll(/^- ([sg]\d+): /gm)].map((m) => m[1]!);
		return Response.json({
			choices: [
				{
					message: {
						content: JSON.stringify({ spans: ids.map((id) => ({ id, reason: 'synthetic', sensitive: true })) })
					},
					finish_reason: 'stop'
				}
			]
		});
	};
	const deps: InferenceDependencies = {
		verifyFiles: vi.fn(async () => true),
		loadModel: vi.fn(async () => model),
		listModels: vi.fn(async () => [{ name: pins.model, digest: pins.digest }]),
		startTier2: (logger) => tier2FromConfig(readConfig({ SC_TIER2_MODEL: pins.model }).tier2, logger, fakeFetch)!,
		availableMemory: () => 12 * 2 ** 30
	};
	return { deps, model, close, score, chats };
}

afterEach(() => vi.useRealTimers());

describe('matching reference and digest gates', () => {
	it('isolates demo settings without changing the parent environment', () => {
		const parent = {
			PATH: 'keep',
			SC_POLICY_FILE: 'company',
			sc_dashboard_url: 'private',
			SC_TIER2_API_KEY: 'secret',
			SC_CHECK_BUDGET_MS: '25000'
		};
		const tier1 = inferenceEnvironment(parent, 'C:/Safe Context José/models', false);
		expect(tier1).toEqual({
			PATH: 'keep',
			SC_AGENT_PORT: '4747',
			SC_TIER1_MODEL_DIR: 'C:/Safe Context José/models',
			SC_TIER1_THREADS: '2'
		});
		expect(parent.SC_TIER2_API_KEY).toBe('secret');
		const combined = inferenceEnvironment(parent, 'C:/models', true);
		expect(combined.SC_TIER2_MODEL).toBe(pins.model);
		expect(combined.SC_TIER2_BASE_URL).toBe('http://127.0.0.1:11434/v1');
		expect(combined.SC_TIER2_API_KEY).toBeUndefined();
	});
	it('accepts only a bounded reference for this model revision', () => {
		expect(parseReference(reference(), revision, true).cases).toHaveLength(2);
		for (const bad of [
			null,
			{},
			{ ...reference(), revision: '0'.repeat(40) },
			{ ...reference(), cases: [] },
			{ ...reference(), origin: '' }
		])
			expect(() => parseReference(bad, revision)).toThrow('reference_invalid');
	});
	it('rejects invalid offsets, unknown labels, missing combined expectations and overlong text', () => {
		const a = reference();
		a.cases[1]!.tier1.spans[0]!.end = 999;
		const b = reference();
		b.cases[1]!.tier1.spans[0]!.dataTypeId = 'secret_user_input';
		const c = reference();
		delete c.cases[0]!.combined;
		const d = reference();
		d.cases[0]!.text = 'x'.repeat(4097);
		for (const bad of [a, b, c, d]) expect(() => parseReference(bad, revision, true)).toThrow('reference_invalid');
	});
	it.each([pins.digest, pins.digest.slice(7)])('accepts the exact digest representation %s', (digest) => {
		expect(() => verifyOllamaPin([{ name: pins.model, digest }], pins)).not.toThrow();
	});
	it('refuses absent, duplicate, changed or malformed models without a weak prefix match', () => {
		for (const models of [
			[],
			[{ name: pins.model + ':latest', digest: pins.digest }],
			[
				{ name: pins.model, digest: pins.digest },
				{ name: pins.model, digest: pins.digest }
			],
			[{ name: pins.model, digest: pins.digest.slice(0, 20) }],
			[{ name: pins.model, digest: 'sha256:' + '0'.repeat(64) }]
		])
			expect(() => verifyOllamaPin(models, pins)).toThrow();
	});
	it('computes nearest-rank timings and refuses empty/bad measurements', () => {
		expect(timings(Array.from({ length: 20 }, (_, i) => 20 - i))).toEqual({ n: 20, p50Ms: 10, p95Ms: 19 });
		for (const bad of [[], [NaN], [-1], [Infinity]]) expect(() => timings(bad)).toThrow('timings_invalid');
	});
});

describe('inference diagnostic, models faked', () => {
	it('keeps load/timing smoke results separate from prediction verification', async () => {
		const { deps, close, score } = setup();
		const result = await smokeTier1(deps);
		expect(result).toMatchObject({
			stage: 'smoke-tier1',
			predictionCorrectness: 'unverified_no_matching_reference',
			warm: { n: 20 },
			warmupCalls: 2,
			measuredCalls: 20
		});
		expect(score.mock.calls.length).toBeGreaterThan(20);
		expect(close).toHaveBeenCalledOnce();
		expect(deps.listModels).not.toHaveBeenCalled();
	});
	it('does not load in smoke mode unless files verify and memory is available', async () => {
		const { deps } = setup();
		deps.verifyFiles = async () => false;
		await expect(smokeTier1(deps)).rejects.toThrow('tier1_files_not_verified');
		expect(deps.loadModel).not.toHaveBeenCalled();
	});
	it('exercises real classifier and prompt/tool contracts, never calling Tier 2 for Tier 1 mode', async () => {
		const { deps, close, score } = setup();
		const out = await checkInference('tier1', reference(), pins, deps);
		expect(out).toMatchObject({
			stage: 'tier1',
			functional: 'passed',
			warm: { n: 20 },
			tier2Ran: false,
			policyBudgetMs: 8000
		});
		expect(score).toHaveBeenCalled();
		expect(deps.listModels).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
		expect(JSON.stringify(out)).not.toContain('Project Heron');
	});
	it('requires actual Tier 2 participation and rechecks its pin after the combined run', async () => {
		const { deps, chats, close } = setup();
		const out = await checkInference('combined', reference(), pins, deps);
		expect(out.tier2Ran).toBe(true);
		expect(chats.mock.calls.length).toBeGreaterThan(2);
		expect(deps.listModels).toHaveBeenCalledTimes(2);
		expect(close).toHaveBeenCalledOnce();
	});
	it('does not load a model for missing files, insufficient memory or bad model pin', async () => {
		for (const reason of ['files', 'memory', 'pin']) {
			const { deps } = setup();
			if (reason === 'files') deps.verifyFiles = async () => false;
			if (reason === 'memory') deps.availableMemory = () => 4 * 2 ** 30;
			if (reason === 'pin') deps.listModels = async () => [{ name: pins.model, digest: 'wrong' }];
			await expect(checkInference('combined', reference(), pins, deps)).rejects.toThrow();
			expect(deps.loadModel).not.toHaveBeenCalled();
		}
	});
	it('reports a native load failure without exposing exception text', async () => {
		const { deps } = setup();
		deps.loadModel = async () => {
			throw new Error('Authorization=synthetic_private_path');
		};
		await expect(checkInference('tier1', reference(), pins, deps)).rejects.toThrow('tier1_load_failed');
	});
	it('refuses mismatched predictions and still releases the model', async () => {
		const { deps, close } = setup();
		const ref = reference();
		ref.cases[1]!.tier1.spans[0]!.end--;
		await expect(checkInference('tier1', ref, pins, deps)).rejects.toThrow('tier1_reference_mismatch');
		expect(close).toHaveBeenCalledOnce();
	});
	it('does not treat a settled ready promise without a ready event as success', async () => {
		const { deps, close } = setup();
		deps.startTier2 = () => ({
			ready: Promise.resolve(),
			tier: { id: 'tier2', tier: 2, detect: (texts) => texts.map(() => []) },
			generalizer: { rewrite: async () => new Map() }
		});
		await expect(checkInference('combined', reference(), pins, deps)).rejects.toThrow('tier2_not_ready');
		expect(close).toHaveBeenCalledOnce();
	});
	it('fails when the server pin changes during the run', async () => {
		const { deps } = setup();
		let n = 0;
		deps.listModels = async () => [{ name: pins.model, digest: n++ ? 'wrong' : pins.digest }];
		await expect(checkInference('combined', reference(), pins, deps)).rejects.toThrow('ollama_digest_mismatch');
	});
});

describe('HTTP health is separate from model readiness', () => {
	it('keeps the server healthy while an enabled model loads, then blocks on load failure', async () => {
		let reject!: (reason?: unknown) => void;
		const model = new Promise<TaggerModel>((_resolve, no) => {
			reject = no;
		});
		const tier = createTier1({ model });
		const app = createApp({
			policy: staticPolicySource(defaultPolicy()),
			classifier: createClassifier({ tiers: [tier], budgetMs: 100 })
		});
		expect((await app.request('/health')).status).toBe(200);
		reject(new Error('synthetic native runtime failure'));
		const response = await app.request(AGENT_API.prompt.path, {
			method: 'POST',
			body: JSON.stringify({
				session_id: 'synthetic',
				cwd: 'C:/synthetic-project',
				hook_event_name: 'UserPromptSubmit',
				prompt: 'Synthetic work item'
			})
		});
		expect(AGENT_API.prompt.response.parse(await response.json()).decision).toBe('block');
		await tier.close();
	});
});
