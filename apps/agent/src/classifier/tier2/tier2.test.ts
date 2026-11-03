/**
 * Tier 2 with the model mocked: a fake OpenAI-compatible server on an ephemeral port. The real
 * model is exercised by `tier2.real.test.ts` (only with `SC_TIER2_REAL=1`).
 */
import type { Span } from '@safecontext/detectors';
import { AGENT_API } from '@safecontext/policy';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.ts';
import { DEFAULT_TIER2_PROMPTS_DIR, readConfig, type Tier2Config } from '../../config.ts';
import { decide } from '../../decide.ts';
import { memoryLogger } from '../../log.ts';
import { staticPolicySource } from '../../policy-source.ts';
import { CANARY, policyWith, SECRET, termTier, toolOutput } from '../../test-helpers.ts';
import { createGeneralize } from '../../transform/generalize.ts';
import { createPseudonymStore } from '../../transform/pseudonyms.ts';
import { createRewriter } from '../../transform/rewrite.ts';
import { createClassifier } from '../classifier.ts';
import { createTier0 } from '../tier0.ts';
import type { ClassifierTier } from '../types.ts';
import { createTier2Client } from './client.ts';
import {
	askedIds,
	completion,
	lastUser,
	startFakeModelServer,
	type ChatAnswer,
	type FakeRequest
} from './fake-server.ts';
import { loadPrompts } from './prompts.ts';
import { createTier2, tier2FromConfig } from './tier2.ts';

const prompts = loadPrompts(DEFAULT_TIER2_PROMPTS_DIR);
const policy = policyWith();
const API_KEY = 'sk-test-' + 'not-a-real-key-4411';

/** A tier 1 stand-in: flags each term as the given data type, as the tagger would. */
function taggerTier(terms: Record<string, string>): ClassifierTier {
	return {
		id: 'tagger',
		tier: 1,
		detect: (texts) =>
			texts.map((text) =>
				Object.entries(terms).flatMap(([term, dataTypeId]) => {
					const i = text.indexOf(term);
					return i === -1
						? []
						: [{ start: i, end: i + term.length, dataTypeId, source: 'tagger' as const, confidence: 0.9 }];
				})
			)
	};
}

/** A context answer: `sensitive(id)` for each span asked about. */
const contextAnswer =
	(sensitive: (id: string) => boolean): ChatAnswer =>
	(req) =>
		JSON.stringify({ spans: askedIds(req).map((id) => ({ id, reason: 'test', sensitive: sensitive(id) })) });

const generalizeAnswer =
	(text: (id: string) => string): ChatAnswer =>
	(req) =>
		JSON.stringify({ rewrites: askedIds(req).map((id) => ({ id, text: text(id) })) });

let servers: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
	await Promise.all(servers.map((s) => s.close()));
	servers = [];
});

async function setup(chat: ChatAnswer, opts: { perCallMs?: number; apiKey?: string; tags?: unknown } = {}) {
	const server = await startFakeModelServer(chat, opts.tags);
	servers.push(server);
	const logger = memoryLogger();
	const client = createTier2Client({ baseUrl: server.baseUrl, model: 'gemma4:e4b-it-q4_K_M', apiKey: opts.apiKey });
	const tier2 = createTier2({ client, prompts, perCallMs: opts.perCallMs, logger });
	return { server, logger, ...tier2 };
}

const PRESS = 'Orbitly announces Heron, now generally available on every plan.';
const PLAN = 'Launch plan: Heron ships to beta customers next month. Internal only.';

describe('tier 2 context judgement', () => {
	it('clears a roadmap span the model says is public, so the press release passes', async () => {
		const { server, tier } = await setup(contextAnswer(() => false));
		const classifier = createClassifier({
			tiers: [createTier0(), taggerTier({ Heron: 'unreleased-roadmap' }), tier],
			budgetMs: 5000
		});
		const result = await classifier.classify([PRESS], policy, { hook: 'UserPromptSubmit' });
		expect(result.ok && result.spans).toEqual([[]]);
		expect(result.ok && result.cleared).toBe(1);
		expect(decide(result, policy).verdict).toBe('allow');
		expect(server.chats()).toHaveLength(1);
	});

	it('keeps a roadmap span the model says is sensitive', async () => {
		const { tier } = await setup(contextAnswer(() => true));
		const classifier = createClassifier({ tiers: [taggerTier({ Heron: 'unreleased-roadmap' }), tier], budgetMs: 5000 });
		const result = await classifier.classify([PLAN], policy, { hook: 'UserPromptSubmit' });
		expect(decide(result, policy).verdict).toBe('block');
	});

	it.each<[string, ChatAnswer]>([
		['bad JSON', () => 'nope, not JSON'],
		['a missing id', () => '{"spans": []}'],
		[
			'a repeated id',
			(req) => {
				const [id] = askedIds(req);
				const e = { id, reason: 'x', sensitive: false };
				return JSON.stringify({ spans: [e, e] });
			}
		],
		['an unknown id', () => '{"spans": [{"id": "s9", "reason": "x", "sensitive": false}]}'],
		['an HTTP error', () => ({ status: 500, body: 'oops' })],
		['a cut-off answer', () => ({ body: completion('{"spans": [', 'length') })],
		['an error body with HTTP 200', () => ({ body: { error: 'model not found' } })]
	])('keeps every span flagged on %s', async (_why, answer) => {
		const { tier, logger } = await setup(answer);
		const classifier = createClassifier({ tiers: [taggerTier({ Heron: 'unreleased-roadmap' }), tier], budgetMs: 5000 });
		const result = await classifier.classify([PRESS], policy, { hook: 'UserPromptSubmit' });
		expect(result.ok).toBe(true);
		expect(decide(result, policy).verdict).toBe('block');
		expect(logger.records.some((r) => r.msg === 'tier2_call_failed' && r.task === 'context')).toBe(true);
	});

	it('keeps spans on a timeout, without failing the check', async () => {
		const { tier, logger } = await setup(() => ({ delayMs: 2_000, body: completion('{}') }), { perCallMs: 300 });
		const classifier = createClassifier({ tiers: [taggerTier({ Heron: 'unreleased-roadmap' }), tier], budgetMs: 5000 });
		const start = performance.now();
		const result = await classifier.classify([PRESS], policy, { hook: 'UserPromptSubmit' });
		expect(performance.now() - start).toBeLessThan(1_500);
		expect(result.ok).toBe(true);
		expect(decide(result, policy).verdict).toBe('block');
		expect(logger.records).toContainEqual({
			level: 'warn',
			msg: 'tier2_call_failed',
			task: 'context',
			reason: 'timeout'
		});
	});

	it('caps a call at the time left in the check, so the check never times out on tier 2', async () => {
		const { tier } = await setup(() => ({ delayMs: 5_000, body: completion('{}') }));
		const classifier = createClassifier({
			tiers: [taggerTier({ Heron: 'unreleased-roadmap' }), tier],
			budgetMs: 2_000
		});
		const result = await classifier.classify([PRESS], policy, { hook: 'UserPromptSubmit' });
		expect(result.ok).toBe(true);
		expect(result.ms).toBeLessThan(2_000);
	});

	it('skips tier 2 (keeping every span) with less than min_budget_ms left', async () => {
		const { tier, server } = await setup(contextAnswer(() => false));
		const classifier = createClassifier({
			tiers: [taggerTier({ Heron: 'unreleased-roadmap' }), tier],
			budgetMs: 1_000
		});
		const result = await classifier.classify([PRESS], policy, { hook: 'UserPromptSubmit' });
		expect(result.ok).toBe(true);
		expect(decide(result, policy).verdict).toBe('block');
		expect(server.chats()).toHaveLength(0);
	});

	it('never sends or clears tier 0 matches, nor labels outside the context list', async () => {
		const { tier, server } = await setup(contextAnswer(() => false));
		const text = `Heron and Quill. Acme Corp paid $4.2M. Token ${SECRET}`;
		const classifier = createClassifier({
			tiers: [
				createTier0(),
				termTier({ Quill: 'unreleased-roadmap' }), // an admin term list match
				taggerTier({ Heron: 'unreleased-roadmap', 'Acme Corp': 'customer-names', '$4.2M': 'revenue-figures' }),
				tier
			],
			budgetMs: 5000
		});
		const result = await classifier.classify([text], policy, { hook: 'PostToolUse' });
		if (!result.ok) throw new Error('check failed');
		const kept = result.spans[0]!.map((s) => text.slice(s.start, s.end));
		expect(kept).toEqual(['Quill', 'Acme Corp', SECRET]);
		const sent = lastUser(server.chats()[0]!);
		expect(sent).toContain('<s1>Heron</s1>');
		expect(sent).toContain('<s2>$4.2M</s2>');
		expect(sent).not.toContain('<s3>');
	});

	it("doesn't call the model when the outcome can't change", async () => {
		const { tier, server } = await setup(contextAnswer(() => false));
		const classifier = createClassifier({
			tiers: [createTier0(), taggerTier({ Heron: 'unreleased-roadmap', '$4.2M': 'revenue-figures' }), tier],
			budgetMs: 5000
		});
		// A secret blocks the prompt anyway.
		await classifier.classify([`Heron, token ${SECRET}`], policy, { hook: 'UserPromptSubmit' });
		// Only yellow data, which passes in a prompt anyway (#50).
		await classifier.classify(['Revenue was $4.2M.'], policy, { hook: 'UserPromptSubmit' });
		// Nothing tagged.
		await classifier.classify(['hello'], policy, { hook: 'PostToolUse' });
		expect(server.chats()).toHaveLength(0);
	});

	it('sends the request #14 scored: model, temperature 0, seed 0, no thinking, the JSON schema', async () => {
		const { tier, server } = await setup(contextAnswer(() => true));
		const classifier = createClassifier({ tiers: [taggerTier({ Heron: 'unreleased-roadmap' }), tier], budgetMs: 5000 });
		await classifier.classify([PLAN], policy, { hook: 'UserPromptSubmit' });
		const req = server.chats()[0]!;
		expect(req.method).toBe('POST');
		expect(req.body).toMatchObject({
			model: 'gemma4:e4b-it-q4_K_M',
			temperature: 0,
			seed: 0,
			stream: false,
			max_tokens: 600,
			reasoning_effort: 'none',
			response_format: {
				type: 'json_schema',
				json_schema: { name: 'Tier2ContextResponse', schema: prompts.tasks.context.schema, strict: true }
			}
		});
		const messages = req.body!.messages as Array<{ role: string }>;
		expect(messages.map((m) => m.role)).toEqual([
			'system',
			...prompts.tasks.context.exampleTurns.map((t) => t.role),
			'user'
		]);
	});
});

describe('the classifier keeps clears safe', () => {
	const greedy = (
		spansToClear: (texts: readonly string[], spans: readonly (readonly Span[])[]) => Span[][]
	): ClassifierTier => ({
		id: 'greedy',
		tier: 2,
		clearable: ['unreleased-roadmap'],
		detect: (texts) => texts.map(() => []),
		clear: async (texts, spans) => spansToClear(texts, spans)
	});

	it('refuses to clear rule or list matches, or data types it may not clear, even when asked', async () => {
		const text = `Quill Heron Acme ${SECRET}`;
		const classifier = createClassifier({
			tiers: [
				createTier0(),
				termTier({ Quill: 'unreleased-roadmap' }),
				taggerTier({ Heron: 'unreleased-roadmap', Acme: 'customer-names' }),
				greedy((_t, spans) => spans.map((s) => [...s]))
			],
			budgetMs: 5000
		});
		const result = await classifier.classify([text], policy, { hook: 'PostToolUse' });
		if (!result.ok) throw new Error('check failed');
		expect(result.spans[0]!.map((s) => text.slice(s.start, s.end))).toEqual(['Quill', 'Acme', SECRET]);
		expect(result.cleared).toBe(1);
	});

	it('only lets tier 2 clear', () => {
		expect(() => createClassifier({ tiers: [{ ...greedy(() => []), tier: 1 }], budgetMs: 100 })).toThrow(/only tier 2/);
	});
});

describe('generalize', () => {
	const text = 'Q3 revenue was $4.2M, up 18%, thanks to Bluefin and the Quill launch on March 3.';
	const at = (s: string, dataTypeId = 'revenue-figures'): Span => ({
		start: text.indexOf(s),
		end: text.indexOf(s) + s.length,
		dataTypeId,
		source: 'tagger',
		confidence: 0.9
	});
	const hits = [
		{
			dataTypeId: 'revenue-figures',
			name: 'Revenue figures',
			tier: 'yellow' as const,
			action: 'generalize' as const,
			count: 1
		},
		{
			dataTypeId: 'customer-names',
			name: 'Customer names',
			tier: 'yellow' as const,
			action: 'pseudonymize' as const,
			count: 1
		}
	];
	const spans = () => [at('$4.2M'), at('18%'), at('Bluefin', 'customer-names'), at('March 3')];

	async function rewriteWith(chat: ChatAnswer) {
		const { generalizer, server, logger } = await setup(chat);
		const generalize = createGeneralize({ model: generalizer, policy, deadline: performance.now() + 5000 });
		const out = await createRewriter(hits, createPseudonymStore().session('s'), generalize)(text, spans());
		return { out, server, logger };
	}

	it('rewrites numbers with the rule and other values with the model', async () => {
		const { out, server } = await rewriteWith(generalizeAnswer(() => 'early next quarter'));
		expect(out).toBe(
			'Q3 revenue was over $4M, up high teens, thanks to customer_name_1 and the Quill launch on early next quarter.'
		);
		// Only the value the rule can't handle went to the model.
		expect(server.chats()).toHaveLength(1);
		expect(askedIds(server.chats()[0]!)).toEqual(['g1']);
		expect(lastUser(server.chats()[0]!)).toContain('<g1>March 3</g1>');
	});

	it.each([
		['repeats the value', 'around March 3'],
		['shares a distinctive word with it', 'in March'],
		['names another flagged value', 'when Bluefin signed'],
		['is not plain text', '[a date]'],
		['is too long', 'a date that is some time in the next quarter']
	])('falls back to the stub when the model rewrite %s', async (_why, rewrite) => {
		const { out } = await rewriteWith(generalizeAnswer(() => rewrite));
		expect(out).toContain('on [Revenue figures].');
		expect(out).not.toContain(rewrite);
	});

	it('falls back to the stub when the model fails, and keeps the rule rewrites', async () => {
		const { out, logger } = await rewriteWith(() => ({ status: 503, body: 'busy' }));
		expect(out).toBe(
			'Q3 revenue was over $4M, up high teens, thanks to customer_name_1 and the Quill launch on [Revenue figures].'
		);
		expect(logger.records).toContainEqual({
			level: 'warn',
			msg: 'tier2_call_failed',
			task: 'generalize',
			reason: 'http_error'
		});
	});

	it('without tier 2: numbers by the rule, everything else the stub', async () => {
		const out = await createRewriter(hits, createPseudonymStore().session('s'))(text, spans());
		expect(out).toBe(
			'Q3 revenue was over $4M, up high teens, thanks to customer_name_1 and the Quill launch on [Revenue figures].'
		);
	});

	it("doesn't call the model without enough time left", async () => {
		const { generalizer, server } = await setup(generalizeAnswer(() => 'soon'));
		const generalize = createGeneralize({ model: generalizer, policy, deadline: performance.now() + 500 });
		const out = await createRewriter(hits, createPseudonymStore().session('s'), generalize)(text, spans());
		expect(out).toContain('on [Revenue figures].');
		expect(server.chats()).toHaveLength(0);
	});
});

describe('auth header and logs', () => {
	it('sends the API key as a Bearer header when set, and never logs it or any text', async () => {
		const { tier, server, logger } = await setup(() => 'garbage', { apiKey: API_KEY });
		const classifier = createClassifier({
			tiers: [taggerTier({ [CANARY]: 'unreleased-roadmap' }), tier],
			budgetMs: 5000
		});
		await classifier.classify([`Plan: ${CANARY} next month.`], policy, { hook: 'UserPromptSubmit' });
		expect(server.chats()[0]!.headers.authorization).toBe(`Bearer ${API_KEY}`);
		const logged = JSON.stringify(logger.records);
		expect(logged).not.toContain(API_KEY);
		expect(logged).not.toContain(CANARY);
	});

	it('sends no Authorization header without a key', async () => {
		const { tier, server } = await setup(contextAnswer(() => true));
		const classifier = createClassifier({ tiers: [taggerTier({ Heron: 'unreleased-roadmap' }), tier], budgetMs: 5000 });
		await classifier.classify([PLAN], policy, { hook: 'UserPromptSubmit' });
		expect(server.chats()[0]!.headers.authorization).toBeUndefined();
	});
});

describe('configuration', () => {
	it('is off unless SC_TIER2_BASE_URL or SC_TIER2_MODEL is set', () => {
		expect(readConfig({}).tier2).toBeUndefined();
		expect(readConfig({ SC_TIER2_MODEL: 'gemma4:e4b-it-q4_K_M' }).tier2).toEqual({
			baseUrl: 'http://127.0.0.1:11434/v1',
			model: 'gemma4:e4b-it-q4_K_M',
			apiKey: undefined,
			promptsDir: DEFAULT_TIER2_PROMPTS_DIR,
			timeoutMs: undefined
		});
		expect(
			readConfig({
				SC_TIER2_BASE_URL: 'https://models.corp.example/v1/',
				SC_TIER2_API_KEY: API_KEY,
				SC_TIER2_TIMEOUT_MS: '4000'
			}).tier2
		).toMatchObject({
			baseUrl: 'https://models.corp.example/v1',
			model: 'gemma4:e4b-it-q4_K_M',
			apiKey: API_KEY,
			timeoutMs: 4000
		});
	});

	it.each(['http://10.0.0.5:11434/v1', 'http://models.corp.example/v1', 'ftp://127.0.0.1/v1', 'not a url'])(
		'refuses %s (only https may leave this Mac)',
		(url) => {
			expect(() => readConfig({ SC_TIER2_BASE_URL: url })).toThrow(/SC_TIER2_BASE_URL/);
		}
	);

	it.each(['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1', 'http://[::1]:11434/v1'])(
		'accepts loopback %s',
		(url) => {
			expect(readConfig({ SC_TIER2_BASE_URL: url }).tier2?.baseUrl).toBe(url);
		}
	);

	it('refuses credentials or a query in the URL, and a bad timeout', () => {
		expect(() => readConfig({ SC_TIER2_BASE_URL: 'https://u:p@models.corp.example/v1' })).toThrow();
		expect(() => readConfig({ SC_TIER2_BASE_URL: 'https://models.corp.example/v1?key=1' })).toThrow();
		expect(() => readConfig({ SC_TIER2_MODEL: 'm', SC_TIER2_TIMEOUT_MS: 'soon' })).toThrow(/SC_TIER2_TIMEOUT_MS/);
	});
});

describe('startup check', () => {
	async function start(tags: unknown, chat: ChatAnswer = contextAnswer(() => true), model = 'gemma4:e4b-it-q4_K_M') {
		const server = await startFakeModelServer(chat, tags);
		servers.push(server);
		const logger = memoryLogger();
		const config: Tier2Config = {
			baseUrl: server.baseUrl,
			model,
			apiKey: undefined,
			promptsDir: DEFAULT_TIER2_PROMPTS_DIR,
			timeoutMs: undefined
		};
		await tier2FromConfig(config, logger)!.ready;
		return { logger, server };
	}
	const msgs = (logger: ReturnType<typeof memoryLogger>) => logger.records.map((r) => [r.msg, r.reason]);

	it('logs tier2_ready when the pinned model and digest are there and it answers', async () => {
		const { logger, server } = await start(undefined);
		expect(msgs(logger)).toEqual([['tier2_ready', undefined]]);
		expect(server.chats()).toHaveLength(1); // the warm-up
	});

	it('logs model_missing, and makes no call, when the model is not pulled', async () => {
		const { logger, server } = await start({ models: [{ name: 'llama3:8b', digest: 'abc' }] });
		expect(msgs(logger)).toEqual([['tier2_unavailable', 'model_missing']]);
		expect(server.chats()).toHaveLength(0);
	});

	it('warns on a digest that is not the pinned one', async () => {
		const { logger } = await start({ models: [{ name: 'gemma4:e4b-it-q4_K_M', digest: 'sha256:0000' }] });
		expect(msgs(logger)).toEqual([
			['tier2_unavailable', 'digest_mismatch'],
			['tier2_ready', undefined]
		]);
	});

	it('skips the model check on a server without /api/tags (not Ollama)', async () => {
		const { logger } = await start(
			null,
			contextAnswer(() => true),
			'company-model'
		);
		expect(msgs(logger)).toEqual([['tier2_ready', undefined]]);
	});

	it('logs unreachable when nothing is listening', async () => {
		const logger = memoryLogger();
		const server = await startFakeModelServer(() => 'x');
		const baseUrl = server.baseUrl;
		await server.close();
		const config: Tier2Config = {
			baseUrl,
			model: 'm',
			apiKey: undefined,
			promptsDir: DEFAULT_TIER2_PROMPTS_DIR,
			timeoutMs: undefined
		};
		await tier2FromConfig(config, logger)!.ready;
		expect(msgs(logger)).toEqual([['tier2_unavailable', 'unreachable']]);
	});

	it('logs tier2_off when not configured, and refuses a missing prompts folder', () => {
		const logger = memoryLogger();
		expect(tier2FromConfig(undefined, logger)).toBeUndefined();
		expect(logger.records).toEqual([{ level: 'info', msg: 'tier2_off' }]);
		const config: Tier2Config = {
			baseUrl: 'http://127.0.0.1:1/v1',
			model: 'm',
			apiKey: undefined,
			promptsDir: '/nonexistent',
			timeoutMs: undefined
		};
		expect(() => tier2FromConfig(config, logger)).toThrow();
	});
});

describe('the agent end to end, model mocked', () => {
	it('generalizes revenue in tool output and lets a press release prompt through', async () => {
		const answer: ChatAnswer = (req: FakeRequest) =>
			lastUser(req).includes('generally available') ? contextAnswer(() => false)(req) : contextAnswer(() => true)(req);
		const { server, tier, generalizer } = await setup(answer);
		const app = createApp({
			policy: staticPolicySource(policy),
			classifier: createClassifier({
				tiers: [
					createTier0(),
					taggerTier({ Heron: 'unreleased-roadmap', '$4.2M': 'revenue-figures', '18%': 'revenue-figures' }),
					tier
				],
				budgetMs: 5000
			}),
			generalizer,
			checkBudgetMs: 5000
		});
		const post = async (path: string, body: unknown) =>
			(await (await app.request(path, { method: 'POST', body: JSON.stringify(body) })).json()) as Record<
				string,
				unknown
			>;

		const out = AGENT_API.toolOutput.response.parse(
			await post(
				AGENT_API.toolOutput.path,
				toolOutput('Bash', { stdout: 'Q3 revenue was $4.2M, up 18%', stderr: '', interrupted: false, isImage: false })
			)
		);
		expect(out.hookSpecificOutput?.updatedToolOutput).toMatchObject({
			stdout: 'Q3 revenue was over $4M, up high teens'
		});

		const prompt = { session_id: 's', cwd: '/w', hook_event_name: 'UserPromptSubmit', prompt: PRESS };
		expect(await post(AGENT_API.prompt.path, prompt)).toEqual({});
		expect(server.chats().length).toBeGreaterThan(0);
	});
});
