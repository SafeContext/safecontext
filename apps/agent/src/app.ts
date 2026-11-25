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
	type UserPromptExpansionInput,
	type UserPromptExpansionOutput,
	type UserPromptSubmitInput,
	type UserPromptSubmitOutput
} from '@safecontext/policy';
import { injectsShell, readSkill, shellAllowed, skillFiles } from './skills.ts';
import { Hono, type Context } from 'hono';
import type { Classifier, ClassifyResult } from './classifier/types.ts';
import { DEFAULT_CHECK_BUDGET_MS } from './config.ts';
import { decide, failDecision, strictness, type Decision, type Failure } from './decide.ts';
import { countHits, noopEventSink, type EventSink } from './events.ts';
import { promptResponse, toolInputResponse, toolOutputResponse } from './hooks.ts';
import { messages } from './messages.ts';
import { silentLogger, type Logger, type Outcome } from './log.ts';
import type { PolicySource } from './policy-source.ts';
import { mapToolOutputText, toolInputTexts, toolOutputTexts } from './tool-text.ts';
import { mergeSpans, type Span } from '@safecontext/detectors';
import { createGeneralize, type GeneralizeModel } from './transform/generalize.ts';
import { allowedBy, dropAllowedModelSpans } from './transform/allow.ts';
import { knownValueFinder } from './transform/known.ts';
import {
	createPlaceholderStore,
	dropPlaceholderSpans,
	type PlaceholderStore,
	type SessionKey
} from './transform/placeholders.ts';
import { restoreToolInput, type Restored } from './transform/restore.ts';
import { mediaKind, type Extractor } from './extract.ts';
import { isAbsolute, resolve as resolvePath } from 'node:path';
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
	/**
	 * Text from images and PDFs before Claude reads one (#40). Without it, such a Read can't be
	 * checked, so the policy's fail mode applies.
	 */
	extractor?: Extractor;
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
	const { generalizer, extractor, checkBudgetMs = DEFAULT_CHECK_BUDGET_MS } = deps;
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
	 * Classify `texts` and decide. Never throws (the classifier doesn't). Placeholders the
	 * session's key issued aren't flagged again (dropPlaceholderSpans). With `findKnown` (tool
	 * output), every value the key holds is flagged too, wherever it appears (transform/known.ts).
	 */
	async function check(texts: string[], policy: Policy, hook: HookEventName, key: SessionKey, findKnown = false) {
		const deadline = now() + checkBudgetMs;
		const classified = await classifier.classify(texts, policy, { hook });
		let result: ClassifyResult = classified;
		if (classified.ok) {
			const known = findKnown ? knownValueFinder(key) : undefined;
			const rank = strictness(policy);
			const allowed = allowedBy(policy);
			const spans = texts.map((text, i) => {
				const found = dropAllowedModelSpans(text, classified.spans[i] ?? [], allowed);
				const again = (known?.(text) ?? []).filter((s) => !allowed(text.slice(s.start, s.end)));
				return mergeSpans(dropPlaceholderSpans(text, [...found, ...again], key), rank);
			});
			result = { ...classified, spans };
		}
		const chars = texts.reduce((n, t) => n + t.length, 0);
		return { result, decision: decide(result, policy), fields: texts.length, chars, deadline };
	}

	/**
	 * A subagent's report handed back through the `SubagentHandback` tool (auto mode, #61). Its
	 * `message` is cleaned like tool output and passed on through `updatedInput`, so the main
	 * Claude gets the report with placeholders rather than losing it. Undefined for other calls, or
	 * when there's nothing to hide.
	 */
	async function cleanHandback(input: PreToolUseInput, policy: Policy) {
		const message = input.tool_name === 'SubagentHandback' ? input.tool_input['message'] : undefined;
		if (typeof message !== 'string') return undefined;
		const checked = await check([message], policy, 'PostToolUse', placeholders.session(input.session_id), true);
		const { decision } = checked;
		if (decision.verdict === 'allow') return undefined;
		if (decision.cause === 'fail') {
			return { ...checked, toolName: input.tool_name, output: toolInputResponse(decision) };
		}
		const cleaned = await rewrite([message], decision, input.session_id, policy, checked.deadline);
		return {
			...checked,
			// Cleaned and passed on, not stopped: counted like cleaned tool output.
			decision: { ...decision, verdict: 'rewrite' as const },
			toolName: input.tool_name,
			output: {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse' as const,
					updatedInput: { ...input.tool_input, message: cleaned?.[0] ?? message }
				}
			}
		};
	}

	/**
	 * A Read of an image or PDF (#40): its text is pulled out on this device and checked as if it
	 * were the tool's output. Anything sensitive stops the Read, since an image can't be cleaned;
	 * if the text can't be pulled out or checked, the fail mode decides. Undefined for any other
	 * call, which goes through the normal checks.
	 */
	async function checkMedia(input: PreToolUseInput, policy: Policy) {
		const filePath = input.tool_name === 'Read' ? input.tool_input['file_path'] : undefined;
		if (typeof filePath !== 'string') return undefined;
		const kind = mediaKind(filePath);
		if (!kind) return undefined;
		const path = isAbsolute(filePath) ? filePath : resolvePath(input.cwd, filePath);
		const deny = (reason: string) => ({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse' as const,
				permissionDecision: 'deny' as const,
				permissionDecisionReason: reason
			}
		});
		let text: string;
		try {
			if (!extractor) throw new Error('no extractor');
			text = await extractor.extract(path, checkBudgetMs);
		} catch {
			const decision = failDecision(policy, 'error');
			return {
				decision,
				toolName: input.tool_name,
				output: decision.verdict === 'block' ? deny(messages.mediaUnchecked(kind)) : {}
			};
		}
		if (!text.trim()) return undefined;
		const checked = await check([text], policy, 'PostToolUse', placeholders.session(input.session_id), true);
		const { decision } = checked;
		if (decision.cause === 'fail') {
			return {
				...checked,
				toolName: input.tool_name,
				output: decision.verdict === 'block' ? deny(messages.mediaUnchecked(kind)) : {}
			};
		}
		if (decision.verdict === 'allow') return undefined;
		// Anything to hide stops the Read: an image or PDF can't be shown with placeholders in it.
		return {
			...checked,
			decision: { ...decision, verdict: 'block' as const },
			toolName: input.tool_name,
			output: deny(messages.mediaBlocked(kind, decision.hits))
		};
	}

	/**
	 * `check` for a large tool output (#110): the texts are checked in line-aligned parts, one
	 * after another, for as long as the budget lasts. `checkedUntil` (one offset per text) is set
	 * when time ran out part way; everything before it was checked, nothing after it was. If not
	 * even the first part could be checked, the result is the classifier's failure, as for `check`.
	 */
	async function checkInParts(texts: string[], policy: Policy, key: SessionKey) {
		const deadline = now() + checkBudgetMs;
		const spans: Span[][] = texts.map(() => []);
		const checkedUntil = texts.map(() => 0);
		const tiers = new Map<string, number>();
		let ms = 0;
		let cleared = 0;
		let failure: ClassifyResult | undefined;
		outer: for (const [i, text] of texts.entries()) {
			for (const [a, b] of lineParts(text, PART_CHARS)) {
				const left = deadline - REWRITE_RESERVE_MS - now();
				if (left <= 0) break outer;
				// Each part is checked with up to OVERLAP_CHARS before it, from a line start, so a
				// multi-line secret across a boundary (a private key block) is still seen whole.
				const from = a === 0 ? 0 : text.lastIndexOf('\n', Math.max(0, a - OVERLAP_CHARS)) + 1;
				const r = await classifier.classify([text.slice(from, b)], policy, { hook: 'PostToolUse', budgetMs: left });
				for (const t of r.tiers) tiers.set(t.id, (tiers.get(t.id) ?? 0) + t.ms);
				ms += r.ms;
				if (!r.ok) {
					failure = r;
					break outer;
				}
				cleared += r.cleared ?? 0;
				for (const s of r.spans[0] ?? []) spans[i]!.push({ ...s, start: s.start + from, end: s.end + from });
				checkedUntil[i] = b;
			}
		}
		const fields = texts.length;
		const chars = texts.reduce((n, t) => n + t.length, 0);
		const timings = [...tiers].map(([id, t]) => ({ id, ms: t }));
		if (checkedUntil.every((c) => c === 0)) {
			const result: ClassifyResult = failure ?? { ok: false, failure: 'timeout', tiers: timings, ms };
			return { result, decision: decide(result, policy), fields, chars, deadline, checkedUntil: undefined };
		}
		const known = knownValueFinder(key);
		const rank = strictness(policy);
		const allowed = allowedBy(policy);
		const merged = texts.map((text, i) => {
			const found = dropAllowedModelSpans(text, spans[i]!, allowed);
			const again = known(text).filter((s) => s.end <= checkedUntil[i]! && !allowed(text.slice(s.start, s.end)));
			return mergeSpans(dropPlaceholderSpans(text, [...found, ...again], key), rank);
		});
		const result: ClassifyResult = { ok: true, spans: merged, tiers: timings, ms, ...(cleared && { cleared }) };
		const complete = checkedUntil.every((c, i) => c === texts[i]!.length);
		return {
			result,
			decision: decide(result, policy),
			fields,
			chars,
			deadline,
			checkedUntil: complete ? undefined : checkedUntil
		};
	}

	/**
	 * A skill or slash command about to run (#42): its own file is checked like a prompt, and a
	 * skill that injects shell output is stopped unless the policy allows it by name. Returns the
	 * reason to stop it, or undefined to let it run. A skill whose files can't be found (a bundled
	 * one, an MCP prompt) isn't checked: its text never comes from the company.
	 */
	async function checkSkill(name: string, cwd: string, sessionId: string, policy: Policy) {
		const files = skillFiles(name, cwd);
		if (files.length === 0) {
			logger.log('info', 'skill_unknown');
			return { decision: { verdict: 'allow' as const, cause: 'clean' as const, hits: [] }, reason: undefined };
		}
		let text: string;
		try {
			text = readSkill(files);
		} catch {
			const decision = failDecision(policy, 'error');
			return { decision, reason: decision.verdict === 'block' ? messages.skillUnchecked(name) : undefined };
		}
		if (injectsShell(text) && !shellAllowed(policy.shellSkills, name)) {
			const decision: Decision = { verdict: 'block', cause: 'policy', hits: [], spans: [[]] };
			return { decision, reason: messages.skillRunsCommands(name) };
		}
		const checked = await check([text], policy, 'UserPromptSubmit', placeholders.session(sessionId));
		const { decision } = checked;
		const reason =
			decision.verdict !== 'block'
				? undefined
				: decision.cause === 'fail'
					? messages.skillUnchecked(name)
					: messages.skillBlocked(name, decision.hits);
		return { ...checked, reason };
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
				const checked = await check([input.prompt], policy, 'UserPromptSubmit', placeholders.session(input.session_id));
				// A background subagent's report arrives as a prompt (#61). It can only be held back, and
				// there's nothing for the user to resend, so it gets its own message and no safe version.
				if (isTaskNotification(input.prompt)) {
					return { ...checked, output: promptResponse(checked.decision, undefined, { subagentReport: true }) };
				}
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
				const handback = await cleanHandback(input, policy);
				if (handback) return handback;
				const media = await checkMedia(input, policy);
				if (media) return media;
				const skill = input.tool_name === 'Skill' ? input.tool_input['skill'] : undefined;
				if (typeof skill === 'string') {
					const checkedSkill = await checkSkill(skill.replace(/^\//, ''), input.cwd, input.session_id, policy);
					if (checkedSkill.reason) {
						return {
							...checkedSkill,
							toolName: input.tool_name,
							output: {
								hookSpecificOutput: {
									hookEventName: 'PreToolUse' as const,
									permissionDecision: 'deny' as const,
									permissionDecisionReason: checkedSkill.reason
								}
							}
						};
					}
				}
				const checked = await check(
					toolInputTexts(input.tool_input),
					policy,
					'PreToolUse',
					placeholders.session(input.session_id)
				);
				// Swap-back (#83): only for a call that isn't blocked, and only into the policy's tools.
				const restored =
					checked.decision.verdict === 'block'
						? undefined
						: restoreToolInput(
								input.tool_name,
								input.tool_input,
								placeholders.session(input.session_id),
								input.cwd,
								policy.swapBack.tools,
								canonicalSpelling(policy)
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

	// Typed slash commands and skills (#42). Counted on the dashboard as prompt checks.
	app.post(
		AGENT_API.promptExpansion.path,
		route<UserPromptExpansionInput, UserPromptExpansionOutput>(
			AGENT_API.promptExpansion,
			'UserPromptSubmit',
			async (input, policy) => {
				if (input.expansion_type !== 'slash_command') {
					return { decision: { verdict: 'allow', cause: 'clean', hits: [] }, output: {} };
				}
				const checked = await checkSkill(input.command_name, input.cwd, input.session_id, policy);
				return { ...checked, output: checked.reason ? { decision: 'block' as const, reason: checked.reason } : {} };
			},
			(decision, body) => {
				const name = (body as { command_name?: unknown } | undefined)?.command_name;
				return {
					decision,
					output:
						decision.verdict === 'block'
							? {
									decision: 'block' as const,
									reason: messages.skillUnchecked(typeof name === 'string' ? name : 'this command')
								}
							: {}
				};
			}
		)
	);

	app.post(
		AGENT_API.toolOutput.path,
		route<PostToolUseInput, PostToolUseOutput>(
			AGENT_API.toolOutput,
			'PostToolUse',
			async (input, policy) => {
				const texts = toolOutputTexts(input.tool_name, input.tool_response);
				const key = placeholders.session(input.session_id);
				if (texts.reduce((n, t) => n + t.length, 0) > PARTIAL_MIN_CHARS) {
					const checked = await checkInParts(texts, policy, key);
					if (checked.checkedUntil) {
						// Part checked, the rest not: clean what was checked, then the fail mode decides the rest.
						const until = checked.checkedUntil;
						const heads = texts.map((t, i) => t.slice(0, until[i]));
						const cleaned =
							(await rewrite(heads, checked.decision, input.session_id, policy, checked.deadline)) ?? heads;
						const out = texts.map((t, i) => {
							const tail = t.slice(until[i]);
							if (!tail) return cleaned[i]!;
							if (policy.failMode === 'allow') return cleaned[i]! + tail;
							return cleaned[i]! + messages.toolOutputPartlyUnchecked(tail.split('\n').length);
						});
						return {
							...checked,
							decision: failDecision(policy, 'timeout', checked.decision.hits),
							toolName: input.tool_name,
							output: {
								hookSpecificOutput: {
									hookEventName: 'PostToolUse',
									updatedToolOutput: mapToolOutputText(input.tool_name, input.tool_response, (_t, i) => out[i]!)
								}
							}
						};
					}
					const rewritten = await rewrite(texts, checked.decision, input.session_id, policy, checked.deadline);
					return {
						...checked,
						toolName: input.tool_name,
						output: toolOutputResponse(checked.decision, input.tool_name, input.tool_response, rewritten)
					};
				}
				const checked = await check(texts, policy, 'PostToolUse', key, true);
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

/**
 * Tool output longer than this (characters, all text fields together) is checked in parts, so a
 * check that runs out of time still returns the part it checked (#110).
 */
export const PARTIAL_MIN_CHARS = 16_000;
/** Most characters per part; parts end at a line break where one is near. */
const PART_CHARS = 8_000;
/**
 * Text before each part checked along with it, so something spread over several lines across a
 * boundary is seen whole. A 4096-bit private key block is about 3,300 characters.
 */
const OVERLAP_CHARS = 4_000;
/** Time kept back from the parts for rewriting (tier 2's vague hints for figures). */
const REWRITE_RESERVE_MS = 1_000;

/** `[start, end)` parts of `text`, at most `max` characters, ending after a line break where possible. */
export function lineParts(text: string, max: number): Array<[number, number]> {
	const out: Array<[number, number]> = [];
	for (let a = 0; a < text.length;) {
		let b = Math.min(text.length, a + max);
		if (b < text.length) {
			const nl = text.lastIndexOf('\n', b - 1);
			if (nl >= a) b = nl + 1;
		}
		out.push([a, b]);
		a = b;
	}
	return out;
}

/** A background subagent's completion notice, which Claude Code delivers as a prompt (#61). */
export function isTaskNotification(prompt: string): boolean {
	return prompt.trimStart().startsWith('<task-notification>');
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

const canonicalCache = new WeakMap<Policy, (value: string) => string | undefined>();

/** The word-list spelling of a value, matched ignoring case (#108). One lookup table per policy. */
function canonicalSpelling(policy: Policy): (value: string) => string | undefined {
	let find = canonicalCache.get(policy);
	if (!find) {
		const terms = new Map<string, string>();
		for (const list of policy.lists) for (const term of list.terms) terms.set(term.trim().toLowerCase(), term.trim());
		find = (value) => terms.get(value.trim().toLowerCase());
		canonicalCache.set(policy, find);
	}
	return find;
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
