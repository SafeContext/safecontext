/**
 * The agent's HTTP API (SPEC.md §3). Claude Code `http` hooks POST their input JSON here and
 * read the hook output JSON from the response.
 *
 * Every hook request goes: validate input → pick the text → classify (classifier/) →
 * decide (decide.ts) → transform flagged spans (transform/) → build the hook output (hooks.ts) →
 * validate output → respond.
 * Whatever goes wrong after the request arrives (bad input, a tier error, the time budget, a
 * bug building the output), the agent still answers 200 with the policy's fail mode
 * (SPEC.md §2a), so Claude Code's own `onFailure` never has to decide.
 */
import {
	AGENT_API,
	type HealthResponse,
	type HookEventName,
	type Policy,
	type PostToolUseInput,
	type PostToolUseOutput,
	type PreToolUseInput,
	type PreToolUseOutput,
	type SessionStartOutput,
	type UserPromptSubmitInput,
	type UserPromptSubmitOutput
} from '@safecontext/policy';
import { Hono, type Context } from 'hono';
import type { Classifier, ClassifyResult } from './classifier/types.ts';
import { DEFAULT_CHECK_BUDGET_MS } from './config.ts';
import { decide, failDecision, strictness, type Decision, type Failure } from './decide.ts';
import { countHits, noopEventSink, type EventSink } from './events.ts';
import { promptResponse, toolInputResponse, toolOutputResponse } from './hooks.ts';
import { messages } from './messages.ts';
import { silentLogger, type Logger, type Outcome } from './log.ts';
import type { PolicySource } from './policy-source.ts';
import { toolInputTexts, toolOutputTexts } from './tool-text.ts';
import { mergeSpans } from '@safecontext/detectors';
import { createGeneralize, type GeneralizeModel } from './transform/generalize.ts';
import { knownValueFinder } from './transform/known.ts';
import {
	createPlaceholderStore,
	dropPlaceholderSpans,
	type PlaceholderStore,
	type SessionKey
} from './transform/placeholders.ts';
import { restoreToolInput, type Restored } from './transform/restore.ts';
import { createRewriter } from './transform/rewrite.ts';

export interface AppDeps {
	policy: PolicySource;
	classifier: Classifier;
	logger?: Logger;
	events?: EventSink;
	/** Per-session placeholder keys (in memory). Default: a new store with the default bounds. */
	placeholders?: PlaceholderStore;
	/** Tier 2's generalize call (#16). Without it, only number values get a vague rewrite. */
	generalizer?: GeneralizeModel;
	/**
	 * The check budget (`SC_CHECK_BUDGET_MS`). Generalize calls must finish within it, counted from
	 * the start of the check. Default `DEFAULT_CHECK_BUDGET_MS`.
	 */
	checkBudgetMs?: number;
	/** Clock in ms. Injected for tests. */
	now?: () => number;
}

/** The bit of a Zod schema we use, so the agent needn't depend on zod directly. */
interface Schema<T> {
	safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly unknown[] } };
}

interface Endpoint<I, O> {
	request: Schema<I>;
	response: Schema<O>;
}

/** What a hook handler produced, before validation and logging. */
interface Handled<O> {
	output: O;
	decision: Decision;
	toolName?: string;
	result?: ClassifyResult;
	fields?: number;
	chars?: number;
	restored?: Restored;
}

export function createApp(deps: AppDeps): Hono {
	const { policy: policySource, classifier, logger = silentLogger, events = noopEventSink } = deps;
	const now = deps.now ?? (() => performance.now());
	const placeholders = deps.placeholders ?? createPlaceholderStore();
	const { generalizer, checkBudgetMs = DEFAULT_CHECK_BUDGET_MS } = deps;
	const app = new Hono();

	app.get(AGENT_API.health.path, (c) =>
		c.json({ ok: true, policyVersion: policySource.current().version } satisfies HealthResponse)
	);

	// For the plugin's SessionStart script: how placeholders work under the current policy (#83).
	app.get(AGENT_API.sessionStart.path, (c) =>
		c.json({
			hookSpecificOutput: {
				hookEventName: 'SessionStart',
				additionalContext: messages.sessionContext(policySource.current().swapBack.tools)
			}
		} satisfies SessionStartOutput)
	);

	/**
	 * Classify `texts` and decide. Never throws (the classifier doesn't). Placeholders already in
	 * the text are never flagged again. With `key` (tool output), every value the session's key
	 * holds is flagged too, wherever it appears (transform/known.ts).
	 */
	async function check(texts: string[], policy: Policy, hook: HookEventName, key?: SessionKey) {
		const deadline = now() + checkBudgetMs;
		const classified = await classifier.classify(texts, policy, { hook });
		let result: ClassifyResult = classified;
		if (classified.ok) {
			const known = key ? knownValueFinder(key) : undefined;
			const rank = strictness(policy);
			const spans = texts.map((text, i) =>
				mergeSpans(dropPlaceholderSpans(text, [...(classified.spans[i] ?? []), ...(known?.(text) ?? [])]), rank)
			);
			result = { ...classified, spans };
		}
		const chars = texts.reduce((n, t) => n + t.length, 0);
		return { result, decision: decide(result, policy), fields: texts.length, chars, deadline };
	}

	/**
	 * Each text with its flagged spans transformed, or undefined if nothing needs transforming.
	 * Placeholders come from the Claude Code session's key. Generalize may call tier 2 within the check's
	 * `deadline`; texts go one at a time (the model server answers one call at a time).
	 */
	async function rewrite(
		texts: readonly string[],
		decision: Decision,
		sessionId: string,
		policy: Policy,
		deadline: number
	): Promise<string[] | undefined> {
		if (decision.cause !== 'policy') return undefined;
		const generalize = createGeneralize({ model: generalizer, policy, deadline });
		const rewriter = createRewriter(decision.hits, placeholders.session(sessionId), generalize);
		const out: string[] = [];
		for (const [i, text] of texts.entries()) out.push(await rewriter(text, decision.spans[i] ?? []));
		return out;
	}

	/**
	 * Shared request flow. `handle` gets validated input; `fail` builds the fail-mode output
	 * when the input is invalid or anything throws. `fail` returns undefined if it can't build
	 * a useful output at all (only for tool output with no tool response to replace).
	 */
	function route<I, O>(
		endpoint: Endpoint<I, O>,
		hook: HookEventName,
		handle: (input: I, policy: Policy) => Promise<Handled<O>>,
		fail: (decision: Decision, body: unknown) => Handled<O> | undefined
	) {
		return async (c: Context) => {
			const start = now();
			const policy = policySource.current();

			const failWith = (failure: Failure, body: unknown, previous?: Handled<O>) => {
				const fallback = fail(failDecision(policy, failure, previous?.decision.hits), body);
				return fallback && { ...previous, ...fallback };
			};

			let body: unknown;
			try {
				body = JSON.parse(await c.req.text());
			} catch {
				body = undefined;
			}

			let handled: Handled<O> | undefined;
			const parsed = endpoint.request.safeParse(body);
			if (!parsed.success) {
				logger.log('warn', 'invalid_input', { hook, issues: parsed.error.issues.length });
				handled = failWith('invalid_input', body);
			} else {
				try {
					handled = await handle(parsed.data, policy);
				} catch {
					logger.log('error', 'handler_error', { hook });
					handled = failWith('error', parsed.data);
				}
				if (handled && !endpoint.response.safeParse(handled.output).success) {
					logger.log('error', 'invalid_output', { hook });
					handled = failWith('invalid_output', parsed.data, handled);
				}
			}

			const totalMs = now() - start;
			if (!handled) {
				// Nothing we can replace (no tool response in the body). Claude Code treats non-2xx as a
				// non-blocking error.
				logger.log('warn', 'check', { hook, outcome: 'fail_block', failure: 'invalid_input', totalMs: round(totalMs) });
				return c.json({ error: 'invalid_input' }, 400);
			}

			const { decision, result } = handled;
			const outcome = outcomeOf(decision);
			const toolName = safeToolName(handled.toolName);
			logger.log(outcome === 'allow' ? 'info' : 'warn', 'check', {
				hook,
				outcome,
				...(decision.cause === 'fail' && { failure: decision.failure }),
				...(toolName !== undefined && { tool: toolName }),
				policyVersion: policy.version,
				...(result && { tiers: result.tiers.map((t) => t.id), classifyMs: round(result.ms) }),
				...(result?.ok && result.cleared && { cleared: result.cleared }),
				...(handled.fields !== undefined && { fields: handled.fields, chars: handled.chars }),
				...(handled.restored?.kind === 'restored' && { restored: handled.restored.count }),
				...(handled.restored?.kind === 'refused' && { restoreRefused: handled.restored.reason }),
				spans: decision.hits.reduce((n, h) => n + h.count, 0),
				totalMs: round(totalMs)
			});
			try {
				events.record({
					ts: new Date().toISOString(),
					policyVersion: policy.version,
					hookEvent: hook,
					...(toolName !== undefined && { toolName }),
					...countHits(decision),
					blocked: wasBlocked(hook, decision),
					latencyMs: totalMs
				});
			} catch {
				// Reporting must never change the answer.
			}
			return c.json(handled.output as object);
		};
	}

	app.post(
		AGENT_API.prompt.path,
		route<UserPromptSubmitInput, UserPromptSubmitOutput>(
			AGENT_API.prompt,
			'UserPromptSubmit',
			async (input, policy) => {
				const checked = await check([input.prompt], policy, 'UserPromptSubmit');
				// Only a blocked prompt needs a safe version (and only then are placeholders handed out).
				const safe =
					checked.decision.verdict === 'block'
						? await rewrite([input.prompt], checked.decision, input.session_id, policy, checked.deadline)
						: undefined;
				return { ...checked, output: promptResponse(checked.decision, safe?.[0]) };
			},
			(decision) => ({ decision, output: promptResponse(decision) })
		)
	);

	app.post(
		AGENT_API.toolInput.path,
		route<PreToolUseInput, PreToolUseOutput>(
			AGENT_API.toolInput,
			'PreToolUse',
			async (input, policy) => {
				const checked = await check(toolInputTexts(input.tool_input), policy, 'PreToolUse');
				// Swap-back (#83): only for a call that isn't blocked, and only into the policy's tools.
				const restored =
					checked.decision.verdict === 'block'
						? undefined
						: restoreToolInput(
								input.tool_name,
								input.tool_input,
								placeholders.session(input.session_id),
								input.cwd,
								policy.swapBack.tools
							);
				return {
					...checked,
					restored,
					toolName: input.tool_name,
					output: toolInputResponse(checked.decision, restored, input.tool_name)
				};
			},
			(decision, body) => ({ decision, toolName: toolNameOf(body), output: toolInputResponse(decision) })
		)
	);

	app.post(
		AGENT_API.toolOutput.path,
		route<PostToolUseInput, PostToolUseOutput>(
			AGENT_API.toolOutput,
			'PostToolUse',
			async (input, policy) => {
				const texts = toolOutputTexts(input.tool_name, input.tool_response);
				const checked = await check(texts, policy, 'PostToolUse', placeholders.session(input.session_id));
				const rewritten = await rewrite(texts, checked.decision, input.session_id, policy, checked.deadline);
				return {
					...checked,
					toolName: input.tool_name,
					output: toolOutputResponse(checked.decision, input.tool_name, input.tool_response, rewritten)
				};
			},
			(decision, body) => {
				// The input may be invalid; replace the output only if there is one to replace.
				const toolName = toolNameOf(body);
				if (decision.verdict === 'allow') return { decision, toolName, output: {} };
				if (toolName === undefined || !hasToolResponse(body)) return undefined;
				return { decision, toolName, output: toolOutputResponse(decision, toolName, body.tool_response) };
			}
		)
	);

	return app;
}

function outcomeOf(decision: Decision): Outcome {
	if (decision.cause === 'fail') return decision.verdict === 'block' ? 'fail_block' : 'fail_allow';
	return decision.verdict;
}

/**
 * AgentEvent `blocked`: the prompt or tool call was stopped. Tool output is never stopped, only
 * cleaned, so it counts as blocked only when it was withheld in full (fail mode).
 */
function wasBlocked(hook: HookEventName, decision: Decision): boolean {
	if (decision.verdict !== 'block') return false;
	return hook !== 'PostToolUse' || decision.cause === 'fail';
}

function toolNameOf(body: unknown): string | undefined {
	const name = (body as { tool_name?: unknown } | undefined)?.tool_name;
	return typeof name === 'string' ? name : undefined;
}

function hasToolResponse(body: unknown): body is { tool_response: unknown } {
	return typeof body === 'object' && body !== null && 'tool_response' in body;
}

/** Tool names go into logs and events, so only keep ones that look like a tool name (AgentEvent's rule). */
function safeToolName(name: string | undefined): string | undefined {
	return name !== undefined && /^[A-Za-z0-9_-]{1,128}$/.test(name) ? name : undefined;
}

const round = (ms: number) => Math.round(ms * 100) / 100;
