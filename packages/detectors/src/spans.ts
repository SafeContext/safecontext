import type { Span } from './types.ts';

/** Build a rule span for `[start, end)`. Rules always have confidence 1. */
export function ruleSpan(start: number, end: number, dataTypeId: string): Span {
	return { start, end, dataTypeId, source: 'rule', confidence: 1 };
}

/**
 * How strict a data type is: higher wins an overlap. The agent ranks by the policy's tiers
 * (red over yellow over green), so text that matches two data types is treated as the
 * stricter one (issue #78).
 */
export type Strictness = (dataTypeId: string) => number;

/**
 * Merge overlapping spans into one span covering all of them, sorted by `start`. Spans that
 * only touch (one ends where the next starts) stay separate.
 *
 * When merged spans disagree on the data type, the strictest data type wins (`strictness`,
 * when given), then the highest confidence, then the earliest in the input array (so callers
 * control precedence by the order they list detectors in: a secret that also looks like an
 * email stays a secret). The merged range always covers every input, so nothing flagged is
 * left exposed.
 */
export function mergeSpans(spans: readonly Span[], strictness?: Strictness): Span[] {
	const order = spans.map((span, index) => ({ span, index }));
	order.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end || a.index - b.index);

	const merged: Span[] = [];
	let winner: { span: Span; index: number } | undefined;
	for (const entry of order) {
		const current = merged.at(-1);
		if (current === undefined || winner === undefined || entry.span.start >= current.end) {
			merged.push({ ...entry.span });
			winner = entry;
			continue;
		}
		current.end = Math.max(current.end, entry.span.end);
		if (beats(entry, winner, strictness)) {
			winner = entry;
			current.dataTypeId = entry.span.dataTypeId;
			current.source = entry.span.source;
			current.confidence = entry.span.confidence;
		}
	}
	return merged;
}

type Ranked = { span: Span; index: number };

function beats(a: Ranked, b: Ranked, strictness?: Strictness): boolean {
	if (strictness && a.span.dataTypeId !== b.span.dataTypeId) {
		const sa = strictness(a.span.dataTypeId);
		const sb = strictness(b.span.dataTypeId);
		if (sa !== sb) return sa > sb;
	}
	if (a.span.confidence !== b.span.confidence) return a.span.confidence > b.span.confidence;
	return a.index < b.index;
}
