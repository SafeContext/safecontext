/**
 * Tier 2 (SPEC.md §4, issue #16): a small LLM behind an OpenAI-compatible API (default Gemma 4
 * E4B on Ollama, chosen in #14). It does two jobs, both with the prompt files in
 * `ml/prompts/tier2/`:
 *
 * 1. **Context judgement** (a classifier tier). For tier 1 spans of the context labels in
 *    `tier2.json` (unreleased roadmap, revenue, metrics, deal sizes), is the span sensitive *in
 *    this document*? A codename in a launch plan is; the same codename in a press release isn't.
 *    Spans it says aren't are cleared. Tier 0 matches (secrets, term lists) are never sent or
 *    cleared, and the classifier enforces that too.
 * 2. **Generalize** (used by transform/generalize.ts): a vague rewrite for values the number
 *    rule can't handle (names, codenames, dates).
 *
 * Failing safe: any failed call (timeout, connection, bad JSON, missing or repeated ids) keeps
 * its spans flagged, or leaves the value to the generalize fallback. Each call is capped at
 * `per_call_ms` (6 s) and at the time left in the check; no call starts with less than
 * `min_budget_ms` (1.5 s) left. Tier 2 itself never fails a check.
 */
import type { Span } from '@safecontext/detectors';
import type { Policy } from '@safecontext/policy';
import { PINNED_TIER2_DIGEST, PINNED_TIER2_MODEL, type Tier2Config } from '../../config.ts';
import { stopsPromptsAndToolCalls, summarize } from '../../decide.ts';
import { silentLogger, type Logger } from '../../log.ts';
import type { GeneralizeModel } from '../../transform/generalize.ts';
import type { ClassifierTier, ClassifyState } from '../types.ts';
import { createTier2Client, Tier2CallError, type Tier2Client } from './client.ts';
import {
	buildRequest,
	excerpts,
	loadPrompts,
	parseAnswer,
	ResponseError,
	type AnswerEntry,
	type DataTypeInfo,
	type Prompts,
	type SpanRef,
	type Task
} from './prompts.ts';

/** Finish this long before the check's deadline, so the classifier never times out waiting. */
const MARGIN_MS = 100;
/** The warm-up call may load the model from disk (~6 s cold, #14). */
const WARMUP_TIMEOUT_MS = 120_000;
const TAGS_TIMEOUT_MS = 3_000;

export interface Tier2Options {
	client: Tier2Client;
	prompts: Prompts;
	/** Cap on one call. Default: `tier2.json` `timeouts.per_call_ms`. */
	perCallMs?: number;
	logger?: Logger;
	/** Clock in ms. Injected for tests. */
	now?: () => number;
}

export interface Tier2 {
	/** The context judgement, as the last classifier tier. */
	tier: ClassifierTier;
	/** The generalize call, for transform/generalize.ts. */
	generalizer: GeneralizeModel;
}

export function createTier2({
	client,
	prompts,
	perCallMs,
	logger = silentLogger,
	now = () => performance.now()
}: Tier2Options): Tier2 {
	const { manifest, tasks } = prompts;
	const perCall = perCallMs ?? manifest.timeouts.per_call_ms;
	const minBudget = manifest.timeouts.min_budget_ms;
	const clearable = new Set(manifest.tasks.context.labels);

	const typeCache = new WeakMap<Policy, Map<string, DataTypeInfo>>();
	const dataTypes = (policy: Policy) => {
		let types = typeCache.get(policy);
		if (!types) {
			types = new Map(policy.dataTypes.map((d) => [d.id, { id: d.id, name: d.name, description: d.description }]));
			typeCache.set(policy, types);
		}
		return types;
	};

	const isCandidate = (policy: Policy) => (s: Span) =>
		s.source === 'tagger' &&
		clearable.has(s.dataTypeId) &&
		policy.dataTypes.some((d) => d.id === s.dataTypeId && d.action !== 'allow');

	/** One task's calls for one text: one per excerpt. Answers for the spans that got one. */
	async function run<S extends SpanRef>(
		task: Task,
		text: string,
		spans: readonly S[],
		policy: Policy,
		deadline: number,
		signal?: AbortSignal
	): Promise<Map<S, AnswerEntry>> {
		const out = new Map<S, AnswerEntry>();
		const { context_chars, max_chars } = manifest.excerpts;
		for (const ex of excerpts(text, spans, context_chars, max_chars)) {
			const left = deadline - now();
			if (left < minBudget || signal?.aborted) {
				logger.log('warn', 'tier2_call_failed', { task: task.name, reason: 'no_budget' });
				break;
			}
			const req = buildRequest(task, ex.text, ex.spans, dataTypes(policy), ex.offset);
			try {
				const answer = await client.chat({
					messages: req.messages,
					schema: task.schema,
					maxTokens: task.maxTokens,
					timeoutMs: Math.min(perCall, left),
					signal
				});
				const parsed = parseAnswer(task, answer, req.ids);
				for (const [id, span] of req.spans) out.set(span, parsed.get(id)!);
			} catch (err) {
				const reason =
					err instanceof Tier2CallError ? err.reason : err instanceof ResponseError ? 'bad_answer' : 'bad_response';
				logger.log('warn', 'tier2_call_failed', { task: task.name, reason });
			}
		}
		return out;
	}

	const tier: ClassifierTier = {
		id: 'tier2',
		tier: 2,
		minBudgetMs: minBudget,
		onLowBudget: 'skip',
		clearable: [...clearable],
		shouldRun: (state) => needsTier2(state, isCandidate(state.policy)),
		detect: (texts) => texts.map(() => []),
		async clear(texts, spans, { policy, signal, remainingMs }) {
			const deadline = now() + remainingMs - MARGIN_MS;
			const candidate = isCandidate(policy);
			const out: Span[][] = texts.map(() => []);
			for (const [i, text] of texts.entries()) {
				const todo = (spans[i] ?? []).filter(candidate);
				if (todo.length === 0) continue;
				const verdicts = await run(tasks.context, text, todo, policy, deadline, signal);
				for (const [span, entry] of verdicts) if (entry.sensitive === false) out[i]!.push(span);
			}
			return out;
		}
	};

	const generalizer: GeneralizeModel = {
		async rewrite(text, spans, policy, deadline) {
			const answers = await run(tasks.generalize, text, spans, policy, deadline - MARGIN_MS);
			const out = new Map<Span, string>();
			for (const [span, entry] of answers) if (typeof entry.text === 'string') out.set(span, entry.text.trim());
			return out;
		}
	};

	return { tier, generalizer };
}

/**
 * Could the context judgement change the result? Only when there are candidate spans (tier 1
 * spans of the context labels). For a prompt or tool input it must also be able to change the
 * verdict: some candidate stops it, and nothing else does. (Yellow data passes there anyway,
 * #50; data tier 2 can't clear blocks it either way.) Tool output: any candidate.
 */
export function needsTier2({ policy, spans, hook }: ClassifyState, isCandidate: (s: Span) => boolean): boolean {
	const all = spans.flat();
	const candidates = all.filter(isCandidate);
	if (candidates.length === 0) return false;
	if (hook === 'UserPromptSubmit' || hook === 'PreToolUse') {
		const stops = (list: Span[]) =>
			summarize(list, policy).some((h) => h.action !== 'allow' && stopsPromptsAndToolCalls(h));
		return !stops(all.filter((s) => !isCandidate(s))) && stops(candidates);
	}
	return true;
}

export interface ConfiguredTier2 extends Tier2 {
	/** Settles when the startup check is done (logged as `tier2_ready` or `tier2_unavailable`). */
	ready: Promise<void>;
}

/**
 * Tier 2 as configured (`SC_TIER2_*`), or undefined when it's off. Loads the prompt files now
 * (a missing or broken file stops the agent). Then, in the background: on Ollama, checks
 * `GET /api/tags` for the model (and the pinned digest), and warms the model up with one small
 * call. Never pulls a model.
 */
export function tier2FromConfig(
	config: Tier2Config | undefined,
	logger: Logger,
	fetchFn: typeof fetch = fetch
): ConfiguredTier2 | undefined {
	if (!config) {
		logger.log('info', 'tier2_off');
		return undefined;
	}
	const prompts = loadPrompts(config.promptsDir);
	const client = createTier2Client({
		baseUrl: config.baseUrl,
		model: config.model,
		apiKey: config.apiKey,
		fetch: fetchFn
	});
	const tier2 = createTier2({ client, prompts, perCallMs: config.timeoutMs, logger });
	return { ...tier2, ready: checkReady(client, prompts, logger) };
}

async function checkReady(client: Tier2Client, prompts: Prompts, logger: Logger): Promise<void> {
	const start = performance.now();
	try {
		const models = await client.listModels(TAGS_TIMEOUT_MS);
		const found = models.find((m) => m.name === client.model || m.name === `${client.model}:latest`);
		if (!found) {
			logger.log('error', 'tier2_unavailable', { reason: 'model_missing' });
			return;
		}
		if (client.model === PINNED_TIER2_MODEL && found.digest.replace(/^sha256:/, '') !== PINNED_TIER2_DIGEST.slice(7)) {
			// Not the weights #14 scored. Keep going, but say so.
			logger.log('warn', 'tier2_unavailable', { reason: 'digest_mismatch' });
		}
	} catch (err) {
		// No /api/tags (HTTP error): not Ollama, e.g. a company model server (#75). Go on to the warm-up.
		if (!(err instanceof Tier2CallError) || err.reason !== 'http_error') {
			logger.log('error', 'tier2_unavailable', { reason: err instanceof Tier2CallError ? err.reason : 'bad_response' });
			return;
		}
	}
	const task = prompts.tasks.context;
	const text = 'Project X ships soon.';
	const req = buildRequest(task, text, [{ start: 0, end: 9, dataTypeId: 'unreleased-roadmap' }], new Map());
	try {
		parseAnswer(
			task,
			await client.chat({
				messages: req.messages,
				schema: task.schema,
				maxTokens: task.maxTokens,
				timeoutMs: WARMUP_TIMEOUT_MS
			}),
			req.ids
		);
		logger.log('info', 'tier2_ready', { totalMs: Math.round(performance.now() - start) });
	} catch (err) {
		const reason =
			err instanceof Tier2CallError ? err.reason : err instanceof ResponseError ? 'bad_answer' : 'bad_response';
		logger.log('error', 'tier2_unavailable', { reason });
	}
}
