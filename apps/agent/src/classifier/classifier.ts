import { mergeSpans, type Span } from '@safecontext/detectors';
import type { Policy } from '@safecontext/policy';
import type { Classifier, ClassifierTier, ClassifyOptions, ClassifyResult, TierTiming } from './types.ts';

export interface ClassifierOptions {
	/** Tiers in the order they run (normally 0, 1, 2). */
	tiers: readonly ClassifierTier[];
	/** Time budget for one `classify` call, in ms. */
	budgetMs: number;
	/** Clock in ms. Injected for tests. */
	now?: () => number;
}

class Timeout extends Error {}

/**
 * Runs the tiers in order within one time budget and merges their spans per text.
 * Any tier error, or running out of budget, returns `ok: false`. The caller then follows the
 * policy's fail mode. It never throws.
 */
export function createClassifier({ tiers, budgetMs, now = () => performance.now() }: ClassifierOptions): Classifier {
	for (const tier of tiers) {
		if (tier.clear && tier.tier !== 2) throw new Error(`${tier.id}: only tier 2 may clear spans`);
	}
	return {
		async classify(texts: readonly string[], policy: Policy, { hook }: ClassifyOptions = {}): Promise<ClassifyResult> {
			const start = now();
			const deadline = start + budgetMs;
			const timings: TierTiming[] = [];
			let spans: Span[][] = texts.map(() => []);
			// Rule and term-list matches, before merging: tier 2 may never clear these.
			const protectedSpans: Span[][] = texts.map(() => []);
			let cleared = 0;
			const controller = new AbortController();

			try {
				for (const tier of tiers) {
					if (tier.shouldRun && !tier.shouldRun({ policy, texts, spans, hook })) continue;
					const remainingMs = deadline - now();
					if (remainingMs <= (tier.minBudgetMs ?? 0)) {
						if (tier.onLowBudget === 'skip') continue;
						throw new Timeout();
					}

					const tierStart = now();
					const ctx = { policy, signal: controller.signal, remainingMs };
					let found: Span[][];
					let toClear: Span[][] | undefined;
					try {
						found = await withDeadline(tier.detect(texts, ctx), remainingMs);
						if (found.length !== texts.length) throw new Error(`${tier.id} returned spans for the wrong number of texts`);
						for (const [i, f] of found.entries()) {
							for (const s of f) if (s.source === 'rule' || s.source === 'list') protectedSpans[i]!.push(s);
						}
						spans = spans.map((existing, i) =>
							found[i]!.length === 0 ? existing : mergeSpans([...existing, ...found[i]!])
						);
						if (tier.clear) {
							const left = deadline - now();
							toClear = await withDeadline(tier.clear(texts, spans, { ...ctx, remainingMs: left }), left);
						}
					} finally {
						timings.push({ id: tier.id, ms: now() - tierStart });
					}
					// A sync tier can't be interrupted, so check the clock after it returns too.
					if (now() > deadline) throw new Timeout();
					if (toClear) {
						if (toClear.length !== texts.length) throw new Error(`${tier.id} cleared spans for the wrong number of texts`);
						const clearable = new Set(tier.clearable ?? []);
						spans = spans.map((current, i) => {
							const keys = new Set(toClear![i]!.map(spanKey));
							const kept = current.filter(
								(s) =>
									!(
										keys.has(spanKey(s)) &&
										s.source === 'tagger' &&
										clearable.has(s.dataTypeId) &&
										!protectedSpans[i]!.some((p) => p.start < s.end && s.start < p.end)
									)
							);
							cleared += current.length - kept.length;
							return kept;
						});
					}
				}
				return { ok: true, spans, tiers: timings, ms: now() - start, ...(cleared > 0 && { cleared }) };
			} catch (err) {
				controller.abort();
				return { ok: false, failure: err instanceof Timeout ? 'timeout' : 'error', tiers: timings, ms: now() - start };
			}
		}
	};
}

const spanKey = (s: Span) => `${s.start}:${s.end}:${s.dataTypeId}`;

async function withDeadline<T>(work: T | Promise<T>, ms: number): Promise<T> {
	if (!(work instanceof Promise)) return work;
	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(new Timeout()), ms);
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
