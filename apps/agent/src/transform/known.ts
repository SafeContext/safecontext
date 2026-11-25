/**
 * Re-hiding (SPEC.md §4, issue #83): every value in the session's key is found again wherever
 * it comes back, whether or not a tier would flag it there. Swap-back (restore.ts) puts real
 * values into files, so they return in Edit and Write results and when the file is read again,
 * often without the context that got them flagged the first time. Each match is a span of the
 * value's own data type, so it gets the same placeholder as before.
 *
 * Matching is the term-list matcher's (case-insensitive, whole words). Values shorter than
 * `MIN_KNOWN_LENGTH`, and generic values (`isGenericValue`), are left to the tiers, so they
 * don't hide every copy of themselves.
 */
import { createTermListDetector, type Span } from '@safecontext/detectors';
import type { SessionKey } from './placeholders.ts';

export const MIN_KNOWN_LENGTH = 3;

/**
 * Values that mean nothing out of context: a percentage ("12%"), a bare year ("2027") or a short
 * plain number ("1400"). Re-hiding them would hide every copy in the session, including discount
 * bands, dates and code (#107), so they are left to the tiers each time. Specific values such as
 * "$4.2M" or "1,400 seats" are still re-hidden.
 */
export function isGenericValue(value: string): boolean {
	const v = value.trim();
	return /^[<>~≈+-]?\d{1,3}(?:[.,]\d+)?\s?%$/.test(v) || /^(?:19|20)\d{2}$/.test(v) || /^\d{1,4}$/.test(v);
}

/** Finds the key's values in a text. Build once per request: the key can change between requests. */
export function knownValueFinder(key: SessionKey): (text: string) => Span[] {
	return finder(
		key.entries().flatMap(({ dataTypeId, spellings }) => spellings.map((value) => ({ dataTypeId, value })))
	);
}

/**
 * Every copy of the values flagged in this call (#144). A tier may flag a value in one place and
 * miss it in another ("Lumen" in a plan's title but not in a later line, a customer's name in a
 * paragraph but not in the heading), so the same output would hide it once and show it once.
 * Each flagged value is found again everywhere in `texts`, as the same data type, so it gets the
 * same placeholder. Same rules as re-hiding: whole words, any case, no short or generic values.
 */
export function sameValueFinder(
	texts: readonly string[],
	spans: readonly (readonly Span[])[]
): (text: string) => Span[] {
	return finder(
		texts.flatMap((text, i) =>
			(spans[i] ?? []).map((s) => ({ dataTypeId: s.dataTypeId, value: text.slice(s.start, s.end) }))
		)
	);
}

function finder(values: Array<{ dataTypeId: string; value: string }>): (text: string) => Span[] {
	const byType = new Map<string, Set<string>>();
	for (const { dataTypeId, value } of values) {
		const term = value.trim();
		// One line only: a span across lines (a key block) has nothing to find again.
		if ([...term].length < MIN_KNOWN_LENGTH || isGenericValue(term) || term.includes('\n')) continue;
		byType.set(dataTypeId, (byType.get(dataTypeId) ?? new Set()).add(term));
	}
	if (byType.size === 0) return () => [];
	const detector = createTermListDetector(
		[...byType].map(([dataTypeId, terms]) => ({ dataTypeId, terms: [...terms] }))
	);
	return (text) => detector.detect(text);
}
