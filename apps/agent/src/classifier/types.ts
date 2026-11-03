import type { HookEventName, Policy } from '@safecontext/policy';
import type { Span } from '@safecontext/detectors';

/**
 * One classifier tier (SPEC.md §4): 0 = rules + term lists, 1 = label tagger (GLiNER, #15),
 * 2 = small LLM (#16). Tiers run in order; each only runs if `shouldRun` says so.
 */
export interface ClassifierTier {
	/** Short stable id for logs, e.g. "tier0". */
	readonly id: string;
	readonly tier: 0 | 1 | 2;
	/**
	 * Don't start this tier with less than this many ms of budget left. Starting anyway would
	 * just hit the deadline, so the classifier reports a timeout straight away (fail mode applies).
	 * Default 0.
	 */
	readonly minBudgetMs?: number;
	/**
	 * What happens when less than `minBudgetMs` is left. `timeout` (default): the check fails
	 * and the fail mode applies. `skip`: carry on without this tier. Only for a tier whose results
	 * can only refine earlier ones (tier 2: skipping it keeps every span flagged).
	 */
	readonly onLowBudget?: 'timeout' | 'skip';
	/**
	 * Whether this tier is needed, given what earlier tiers found. Default: always run.
	 * Tier 1 uses this to run "only when tier 0 isn't conclusive" (#15).
	 */
	shouldRun?(state: ClassifyState): boolean;
	/**
	 * Find spans in each text. Returns one array per input text, in the same order.
	 * May be sync (tier 0) or async (tiers 1 and 2). Async tiers should stop work when
	 * `ctx.signal` aborts (the deadline passed); the result is ignored after that anyway.
	 */
	detect(texts: readonly string[], ctx: TierContext): Span[][] | Promise<Span[][]>;
	/**
	 * Tier 2 only (#16): of the spans found so far, which are NOT sensitive in context (a codename
	 * in a press release)? Returns, per text, spans copied from `spans`; the classifier removes
	 * them. It runs after `detect` and must return before `ctx.remainingMs` runs out.
	 *
	 * The classifier only lets a clear through for a span of a data type in `clearable` that
	 * came from the tagger (tier 1), never one from tier 0's rules or term lists, nor one that
	 * overlaps a rule or list match. Anything else asked to be cleared stays flagged.
	 */
	clear?(texts: readonly string[], spans: readonly (readonly Span[])[], ctx: TierContext): Promise<Span[][]>;
	/** The data type ids `clear` may remove (tier 2: the context labels in `tier2.json`). */
	readonly clearable?: readonly string[];
}

export interface TierContext {
	policy: Policy;
	/** Aborts when the check's time budget runs out. */
	signal: AbortSignal;
	/** Milliseconds of budget left when this tier started. */
	remainingMs: number;
}

/** What earlier tiers found, passed to `shouldRun`. */
export interface ClassifyState {
	policy: Policy;
	texts: readonly string[];
	/** Merged spans so far, one array per text. */
	spans: readonly Span[][];
	/** Which hook the texts come from, if known. */
	hook?: HookEventName;
}

export interface ClassifyOptions {
	/** Which hook the texts come from. Lets a tier skip work that can't change the outcome. */
	hook?: HookEventName;
}

export interface TierTiming {
	id: string;
	ms: number;
}

export type ClassifyResult =
	/** `cleared`: spans tier 2 judged not sensitive in context and removed. */
	| { ok: true; spans: Span[][]; tiers: TierTiming[]; ms: number; cleared?: number }
	/** Checking couldn't finish: the policy's fail mode decides (SPEC.md §2a). */
	| { ok: false; failure: 'error' | 'timeout'; tiers: TierTiming[]; ms: number };

export interface Classifier {
	classify(texts: readonly string[], policy: Policy, options?: ClassifyOptions): Promise<ClassifyResult>;
}
