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
	const byType = new Map<string, string[]>();
	for (const { dataTypeId, spellings } of key.entries()) {
		for (const spelling of spellings) {
			const term = spelling.trim();
			if ([...term].length < MIN_KNOWN_LENGTH || isGenericValue(term)) continue;
			byType.set(dataTypeId, [...(byType.get(dataTypeId) ?? []), term]);
		}
	}
	if (byType.size === 0) return () => [];
	const detector = createTermListDetector([...byType].map(([dataTypeId, terms]) => ({ dataTypeId, terms })));
	return (text) => detector.detect(text);
}
