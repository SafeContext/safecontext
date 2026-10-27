import { AGENT_API, defaultPolicy, type DataType } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { readConfig } from '../../config.ts';
import { memoryLogger } from '../../log.ts';
import { policyWith, promptInput, SECRET, testApp, toolInput, toolOutput } from '../../test-helpers.ts';
import { createClassifier } from '../classifier.ts';
import { createTier0 } from '../tier0.ts';
import type { ClassifyState } from '../types.ts';
import type { Encoded, TaggerModel } from './gliner.ts';
import { createTier1, labelTemplate, needsTier1, tier1FromConfig } from './tier1.ts';

const SEP = -1;

/**
 * A stand-in for GLiNER. Token ids are char codes, so a word costs one token per character and
 * the label texts can be read back from the prompt. It scores 5 (≈ 0.99) for each phrase in
 * `entities` whose label is in the prompt, and -10 for everything else.
 */
function fakeModel(
	entities: Record<string, string>,
	opts: { maxWords?: number; maxTokens?: number; ms?: number; labels?: Record<string, string> } = {}
) {
	const calls: { labels: string[]; words: string[] }[] = [];
	let inFlight = 0;
	let maxInFlight = 0;
	const model: TaggerModel = {
		maxWidth: 3,
		maxWords: opts.maxWords ?? 384,
		maxTokens: opts.maxTokens ?? 512,
		...(opts.labels && { labels: opts.labels }),
		tokenize: (text) => [...text].map((c) => c.charCodeAt(0)),
		promptIds: (labels: readonly Encoded[]) => labels.flatMap((l) => [SEP, ...l.ids]),
		async score(promptIds, labelCount, words) {
			inFlight++;
			maxInFlight = Math.max(maxInFlight, inFlight);
			try {
				if (opts.ms) await new Promise((r) => setTimeout(r, opts.ms));
				const labels = String.fromCharCode(...promptIds.map((id) => (id === SEP ? 0 : id)))
					.split('\0')
					.slice(1);
				expect(labels).toHaveLength(labelCount);
				calls.push({ labels, words: words.map((w) => w.text) });
				const logits = new Float32Array(words.length * 3 * labelCount).fill(-10);
				for (let s = 0; s < words.length; s++) {
					for (let w = 0; w < 3 && s + w < words.length; w++) {
						const phrase = words
							.slice(s, s + w + 1)
							.map((x) => x.text)
							.join(' ');
						const k = labels.indexOf(entities[phrase] ?? '');
						if (k !== -1) logits[(s * 3 + w) * labelCount + k] = 5;
					}
				}
				return logits;
			} finally {
				inFlight--;
			}
		},
		close: async () => {}
	};
	return { model, calls, maxInFlight: () => maxInFlight };
}

const ctx = (policy = defaultPolicy()) => ({ policy, signal: new AbortController().signal, remainingMs: 1_000 });
const names = (policy = defaultPolicy()) => policy.dataTypes.filter((d) => d.action !== 'allow').map((d) => d.name);

describe('tier 1 labels', () => {
	it('uses the policy’s data type names, except types whose action is allow', async () => {
		const { model, calls } = fakeModel({ Northwind: 'Customer names' });
		const tier1 = createTier1({ model });
		const text = 'Renewal for Northwind is due.';
		const [spans] = await tier1.detect([text], ctx());
		expect(calls[0]!.labels).toEqual(names());
		expect(calls[0]!.labels).not.toContain('Public docs');
		expect(spans).toEqual([
			{ start: 12, end: 21, dataTypeId: 'customer-names', source: 'tagger', confidence: expect.closeTo(0.993, 3) }
		]);
	});

	it('takes an admin’s own data types, and can include descriptions', async () => {
		const custom: DataType = {
			id: 'acquisitions',
			name: 'Acquisition targets',
			description: 'Companies we may buy.',
			examples: [],
			tier: 'red',
			action: 'block'
		};
		const policy = policyWith({ dataTypes: [...defaultPolicy().dataTypes, custom] });
		const { model, calls } = fakeModel({ Contoso: 'Acquisition targets: Companies we may buy.' }, { maxTokens: 4_000 });
		const tier1 = createTier1({ model, label: labelTemplate('{name}: {description}') });
		const [spans] = await tier1.detect(['We could buy Contoso'], ctx(policy));
		expect(calls[0]!.labels.at(-1)).toBe('Acquisition targets: Companies we may buy.');
		expect(spans!.map((s) => s.dataTypeId)).toEqual(['acquisitions']);
	});

	it('prefers the label texts shipped with the model (labels.json)', async () => {
		const { model, calls } = fakeModel(
			{ Northwind: 'customer name' },
			{ labels: { 'customer-names': 'customer name' } }
		);
		const [spans] = await createTier1({ model }).detect(['Northwind'], ctx());
		expect(calls[0]!.labels).toContain('customer name');
		expect(calls[0]!.labels).toContain('Revenue figures');
		expect(spans!.map((s) => s.dataTypeId)).toEqual(['customer-names']);
	});

	it('respects the threshold', async () => {
		const { model } = fakeModel({ Northwind: 'Customer names' }); // scores ≈ 0.993
		expect((await createTier1({ model, threshold: 0.999 }).detect(['Northwind'], ctx()))[0]).toEqual([]);
	});

	it('errors when the label prompt leaves no room for text', async () => {
		const { model } = fakeModel({}, { maxTokens: 64 });
		await expect(createTier1({ model }).detect(['hello'], ctx())).rejects.toThrow(/too long/);
	});
});

describe('tier 1 on long text', () => {
	it('cuts text into overlapping windows and finds entities across a window edge once', async () => {
		const { model, calls } = fakeModel({ 'Project Blue Bird': 'Unreleased roadmap' }, { maxWords: 10 });
		const words = Array.from({ length: 30 }, (_, i) => `w${i}`);
		words.splice(8, 0, 'Project', 'Blue', 'Bird'); // words 8-10 straddle the first edge (10)
		const text = words.join(' ');
		const [spans] = await createTier1({ model }).detect([text], ctx());
		expect(calls.length).toBeGreaterThan(3);
		expect(calls.every((c) => c.words.length <= 10)).toBe(true);
		expect(spans).toHaveLength(1);
		expect(text.slice(spans![0]!.start, spans![0]!.end)).toBe('Project Blue Bird');
	});

	it('returns no spans for empty text without calling the model', async () => {
		const { model, calls } = fakeModel({});
		expect(await createTier1({ model }).detect(['', '  \n'], ctx())).toEqual([[], []]);
		expect(calls).toEqual([]);
	});

	it('runs one window at a time across concurrent checks', async () => {
		const { model, calls, maxInFlight } = fakeModel({}, { maxWords: 5, ms: 2 });
		const tier1 = createTier1({ model });
		const text = Array.from({ length: 20 }, (_, i) => `w${i}`).join(' ');
		await Promise.all([tier1.detect([text], ctx()), tier1.detect([text], ctx())]);
		expect(calls.length).toBeGreaterThan(4);
		expect(maxInFlight()).toBe(1);
	});
});

describe('when tier 1 runs (shouldRun)', () => {
	const policy = defaultPolicy();
	const secret = [{ start: 0, end: 5, dataTypeId: 'secrets', source: 'rule' as const, confidence: 1 }];
	const customer = [{ start: 0, end: 5, dataTypeId: 'customer-names', source: 'list' as const, confidence: 1 }];
	const state = (over: Partial<ClassifyState>): ClassifyState => ({ policy, texts: ['hello'], spans: [[]], ...over });

	it('runs when tier 0 found nothing, or only data that does not stop a prompt', () => {
		expect(needsTier1(state({ hook: 'UserPromptSubmit' }))).toBe(true);
		expect(needsTier1(state({ hook: 'UserPromptSubmit', spans: [customer] }))).toBe(true);
	});

	it('skips a prompt or tool input that tier 0 already blocks', () => {
		expect(needsTier1(state({ hook: 'UserPromptSubmit', spans: [secret] }))).toBe(false);
		expect(needsTier1(state({ hook: 'PreToolUse', texts: ['a', 'b'], spans: [[], secret] }))).toBe(false);
	});

	it('still runs on tool output that tier 0 flagged, since every span is cleaned', () => {
		expect(needsTier1(state({ hook: 'PostToolUse', spans: [secret] }))).toBe(true);
		expect(needsTier1(state({ spans: [secret] }))).toBe(true);
	});

	it('skips when there is no text, or no data type to tag', () => {
		expect(needsTier1(state({ texts: ['', ' \n\t'], spans: [[], []] }))).toBe(false);
		const allAllow = policyWith({ dataTypes: policy.dataTypes.filter((d) => d.action === 'allow') });
		expect(needsTier1(state({ policy: allAllow }))).toBe(false);
	});
});

describe('tier 1 in the classifier', () => {
	const policy = defaultPolicy();

	it('runs after tier 0 and merges its spans', async () => {
		const { model } = fakeModel({ Northwind: 'Customer names' });
		const c = createClassifier({ tiers: [createTier0(), createTier1({ model })], budgetMs: 1_000 });
		const result = await c.classify([`Northwind ${SECRET}`], policy, { hook: 'PostToolUse' });
		expect(result.ok && result.spans[0]!.map((s) => s.dataTypeId)).toEqual(['customer-names', 'secrets']);
		expect(result.tiers.map((t) => t.id)).toEqual(['tier0', 'tier1']);
	});

	it('is skipped for a prompt that tier 0 already blocks', async () => {
		const { model, calls } = fakeModel({});
		const c = createClassifier({ tiers: [createTier0(), createTier1({ model })], budgetMs: 1_000 });
		const result = await c.classify([`key ${SECRET}`], policy, { hook: 'UserPromptSubmit' });
		expect(result.tiers.map((t) => t.id)).toEqual(['tier0']);
		expect(calls).toEqual([]);
	});

	it('stops calling the model once the budget runs out (timeout, so the fail mode applies)', async () => {
		const { model, calls } = fakeModel({}, { maxWords: 5, ms: 20 });
		const c = createClassifier({ tiers: [createTier1({ model })], budgetMs: 70 });
		const text = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');
		const result = await c.classify([text], policy);
		expect(result).toMatchObject({ ok: false, failure: 'timeout' });
		await new Promise((r) => setTimeout(r, 60));
		expect(calls.length).toBeLessThan(6); // 50 windows if it had kept going
	});

	it('waits for the model to load, within the budget', async () => {
		const { model } = fakeModel({ Northwind: 'Customer names' });
		const loading = new Promise<TaggerModel>((r) => setTimeout(() => r(model), 20));
		const c = createClassifier({ tiers: [createTier1({ model: loading })], budgetMs: 1_000 });
		const result = await c.classify(['Northwind'], policy);
		expect(result.ok && result.spans[0]!.map((s) => s.dataTypeId)).toEqual(['customer-names']);
	});

	it('times out if the model is still loading when the budget runs out', async () => {
		const never = new Promise<TaggerModel>(() => {});
		const result = await createClassifier({ tiers: [createTier1({ model: never })], budgetMs: 60 }).classify(
			['hi'],
			policy
		);
		expect(result).toMatchObject({ ok: false, failure: 'timeout' });
	});

	it('reports an error if the model failed to load (so the fail mode applies)', async () => {
		const tier1 = createTier1({ model: Promise.reject(new Error('no model')) });
		const result = await createClassifier({ tiers: [tier1], budgetMs: 1_000 }).classify(['hi'], policy);
		expect(result).toMatchObject({ ok: false, failure: 'error' });
	});
});

describe('tier 1 end to end', () => {
	const { model } = fakeModel({ 'Project Bluebird': 'Unreleased roadmap', Globex: 'Customer names' });
	const tiers = () => [createTier0(), createTier1({ model })];
	const { prompt, toolInput: preTool, toolOutput: postTool } = AGENT_API;

	it('blocks a prompt with red data that only tier 1 finds', async () => {
		const { post, logger } = testApp({ tiers: tiers() });
		const out = prompt.response.parse((await post(prompt.path, promptInput('When does Project Bluebird ship?'))).json);
		expect(out.decision).toBe('block');
		expect(out.reason).toContain('Unreleased roadmap');
		expect(out.reason).not.toContain('Bluebird');
		expect(logger.records.find((r) => r.msg === 'check')?.tiers).toEqual(['tier0', 'tier1']);
	});

	it('denies a tool call and cleans tool output with tier 1 spans', async () => {
		const { post } = testApp({ tiers: tiers() });
		const denied = await post(preTool.path, toolInput('Bash', { command: 'grep "Project Bluebird" -r .' }));
		expect(preTool.response.parse(denied.json).hookSpecificOutput?.permissionDecision).toBe('deny');
		const res = await post(postTool.path, toolOutput('Bash', { stdout: 'Globex renewed', stderr: '' }));
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toEqual({
			stdout: 'customer_name_1 renewed',
			stderr: ''
		});
	});
});

describe('tier 1 config', () => {
	it('is off unless SC_TIER1_MODEL_DIR is set', () => {
		expect(readConfig({}).tier1).toBeUndefined();
		const logger = memoryLogger();
		expect(tier1FromConfig(undefined, logger)).toBeUndefined();
		expect(logger.records.map((r) => r.msg)).toEqual(['tier1_off']);
	});

	it('reads the SC_TIER1_* settings', () => {
		expect(readConfig({ SC_TIER1_MODEL_DIR: '/models/x' }).tier1).toEqual({
			modelDir: '/models/x',
			modelFile: 'model.onnx',
			threshold: 0.5,
			threads: 0,
			labelTemplate: '{name}'
		});
		expect(
			readConfig({
				SC_TIER1_MODEL_DIR: '/models/x',
				SC_TIER1_MODEL_FILE: 'model_fp16.onnx',
				SC_TIER1_THRESHOLD: '0.35',
				SC_TIER1_THREADS: '4',
				SC_TIER1_LABEL: '{name}: {description}'
			}).tier1
		).toMatchObject({
			modelFile: 'model_fp16.onnx',
			threshold: 0.35,
			threads: 4,
			labelTemplate: '{name}: {description}'
		});
	});

	it('rejects bad settings', () => {
		const dir = { SC_TIER1_MODEL_DIR: '/m' };
		expect(() => readConfig({ ...dir, SC_TIER1_THRESHOLD: '1.5' })).toThrow(/SC_TIER1_THRESHOLD/);
		expect(() => readConfig({ ...dir, SC_TIER1_THRESHOLD: 'high' })).toThrow(/SC_TIER1_THRESHOLD/);
		expect(() => readConfig({ ...dir, SC_TIER1_THREADS: '-1' })).toThrow(/SC_TIER1_THREADS/);
		expect(() => readConfig({ ...dir, SC_TIER1_LABEL: 'no placeholder' })).toThrow(/SC_TIER1_LABEL/);
	});

	it('logs a model that fails to load, and fails checks rather than skipping them', async () => {
		const logger = memoryLogger();
		const config = readConfig({ SC_TIER1_MODEL_DIR: '/nonexistent/model' }).tier1;
		const tier1 = tier1FromConfig(config, logger)!;
		const result = await createClassifier({ tiers: [tier1], budgetMs: 2_000 }).classify(['hi'], defaultPolicy());
		expect(result).toMatchObject({ ok: false, failure: 'error' });
		expect(logger.records.map((r) => r.msg)).toEqual(['tier1_failed']);
		await tier1.close();
	});
});
