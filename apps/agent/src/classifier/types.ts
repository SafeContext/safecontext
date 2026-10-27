import type { Policy } from '@safecontext/policy';
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
}

export interface TierTiming {
	id: string;
	ms: number;
}

export type ClassifyResult =
	| { ok: true; spans: Span[][]; tiers: TierTiming[]; ms: number }
	/** Checking couldn't finish: the policy's fail mode decides (SPEC.md §2a). */
	| { ok: false; failure: 'error' | 'timeout'; tiers: TierTiming[]; ms: number };

export interface Classifier {
	classify(texts: readonly string[], policy: Policy): Promise<ClassifyResult>;
}
