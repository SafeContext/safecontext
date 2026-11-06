/**
 * `generalize`: replace a value with a vague but true version (SPEC.md §4, issue #16).
 *
 * 1. A span that is one number ("$4.2M", "18%") gets the deterministic rewrite from numbers.ts
 *    ("over $4M", "high teens"). It is true by construction and scored 100% clean in #14.
 * 2. Other values (names, codenames, dates, mixed text) go to the tier 2 model's generalize
 *    prompt, when tier 2 is on and there is time left.
 * 3. Every rewrite, from the rule or the model, must pass `isSafeRewrite` (no leak of the value
 *    or of another flagged value in the text, short, plain). Anything that fails, or gets no
 *    answer, gets no hint: the caller shows the bare placeholder (`⟪revenue_figure_1⟫`).
 */
import type { Span } from '@safecontext/detectors';
import type { Policy } from '@safecontext/policy';
import { isTrue, leaksValue, parseValue, ruleRewrite, tooPrecise } from './numbers.ts';

export const MAX_REWRITE_WORDS = 6;
export const MAX_REWRITE_CHARS = 60;

/** One line, 1–60 characters, at most 6 words, no markup, brackets or quotes, not the original. */
export function checkFormat(rewrite: string, original: string): boolean {
	const r = rewrite.trim();
	const chars = [...r].length;
	return (
		chars > 0 &&
		chars <= MAX_REWRITE_CHARS &&
		!r.includes('\n') &&
		r.split(/\s+/).length <= MAX_REWRITE_WORDS &&
		!/[<>[\]{}"“”]/.test(r) &&
		r.toLowerCase() !== original.trim().toLowerCase()
	);
}

/**
 * Words a vague rewrite of a name may share with it ("Bluefin Logistics" → "a logistics
 * customer"). From `ml/src/safecontext_ml/tier2/generalize_eval.py`.
 */
const GENERIC_WORDS = new Set([
	'project',
	'the',
	'and',
	'of',
	'for',
	'inc',
	'ltd',
	'llc',
	'corp',
	'company',
	'group',
	'labs',
	'systems',
	'partners',
	'logistics',
	'health',
	'bank',
	'foods',
	'retail',
	'insurance',
	'energy',
	'pharma',
	'credit',
	'union',
	'airlines',
	'media'
]);

/**
 * Distinctive words of a value: 3+ characters (or all digits), not generic. With `wordsOnly`
 * (for a value with a number in it), only tokens with a letter: the number checks cover digits.
 */
function tokens(text: string, wordsOnly: boolean): Set<string> {
	const out = new Set<string>();
	for (const t of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
		if (GENERIC_WORDS.has(t)) continue;
		const digits = /^\d+$/.test(t);
		if (wordsOnly ? !digits && t.length >= 3 && /[a-z]/.test(t) : t.length >= 3 || digits) out.add(t);
	}
	return out;
}

/**
 * The leak check: is `rewrite` safe to put in place of `original`? `others`: the other flagged
 * values in the same text, which must not appear in it either.
 */
export function isSafeRewrite(rewrite: string, original: string, others: readonly string[] = []): boolean {
	if (!checkFormat(rewrite, original)) return false;
	const low = rewrite.toLowerCase();
	if (low.includes(original.trim().toLowerCase())) return false;
	const val = parseValue(original);
	if (val) {
		if (leaksValue(rewrite, val, original) || tooPrecise(rewrite, val) || isTrue(rewrite, val) === false) return false;
	}
	const mine = tokens(original, val !== undefined);
	for (const t of tokens(rewrite, val !== undefined)) if (mine.has(t)) return false;
	return !others.some((o) => o.trim().length >= 3 && low.includes(o.trim().toLowerCase()));
}

/** Tier 2's generalize call: raw answers (not yet checked) for the spans it could answer. */
export interface GeneralizeModel {
	rewrite(text: string, spans: readonly Span[], policy: Policy, deadline: number): Promise<ReadonlyMap<Span, string>>;
}

/**
 * Rewrites `targets` (spans of `text` whose action is `generalize`). `all` is every flagged span
 * in the text, targets included (the leak check keeps the other values out of each rewrite).
 * Returns a rewrite per target it could make safely; the rest get no hint.
 */
export type Generalize = (
	text: string,
	targets: readonly Span[],
	all: readonly Span[]
) => Promise<ReadonlyMap<Span, string>>;

export interface GeneralizeOptions {
	/** Tier 2 (#16). Without it, only number spans are rewritten (by the rule). */
	model?: GeneralizeModel;
	policy?: Policy;
	/** performance.now() time by which the model must have answered. */
	deadline?: number;
}

export function createGeneralize({ model, policy, deadline = Infinity }: GeneralizeOptions = {}): Generalize {
	return async (text, targets, all) => {
		const out = new Map<Span, string>();
		const value = (s: Span) => text.slice(s.start, s.end);
		const others = (s: Span) => all.filter((o) => o !== s).map(value);
		const forModel: Span[] = [];
		for (const span of targets) {
			const rule = ruleRewrite(value(span));
			if (rule !== undefined && isSafeRewrite(rule, value(span), others(span))) out.set(span, rule);
			else if (rule === undefined) forModel.push(span);
		}
		if (model && policy && forModel.length > 0) {
			let answers: ReadonlyMap<Span, string> = new Map();
			try {
				answers = await model.rewrite(text, forModel, policy, deadline);
			} catch {
				// The model reports its own failures; every value then falls back.
			}
			for (const span of forModel) {
				const answer = answers.get(span)?.trim();
				if (answer !== undefined && isSafeRewrite(answer, value(span), others(span))) out.set(span, answer);
			}
		}
		return out;
	};
}
