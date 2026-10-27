/**
 * Applies each span's action to the text (SPEC.md §4):
 * - allow: unchanged
 * - mask: `****4242` (mask.ts)
 * - pseudonymize: `customer_name_1`, consistent within the session (pseudonyms.ts)
 * - generalize: `[Revenue figures]` for now. STUB until tier 2 (#16) can write a vague but true
 *   version ("mid-teens growth").
 * - block: `[Safe Context removed: API keys & secrets]`
 *
 * Only the spans change; the text around them is kept exactly.
 */
import type { Span } from '@safecontext/detectors';
import type { Hit } from '../decide.ts';
import { messages } from '../messages.ts';
import { mask } from './mask.ts';
import type { SessionPseudonyms } from './pseudonyms.ts';

/** Rewrites one text, given that text's spans. */
export type Rewriter = (text: string, spans: readonly Span[]) => string;

/**
 * `hits` give each data type's action and name (summarize() already maps data types missing from
 * the policy to `block`). A span whose type isn't in `hits` is removed, to be safe.
 */
export function createRewriter(hits: readonly Hit[], pseudonyms: SessionPseudonyms): Rewriter {
	const byId = new Map(hits.map((h) => [h.dataTypeId, h]));

	const replace = (span: Span, value: string): string => {
		const hit = byId.get(span.dataTypeId);
		if (!hit) return messages.removed(span.dataTypeId);
		switch (hit.action) {
			case 'allow':
				return value;
			case 'mask':
				return mask(value);
			case 'pseudonymize':
				return pseudonyms.get(hit.dataTypeId, value);
			case 'generalize':
				return messages.generalized(hit.name);
			case 'block':
				return messages.removed(hit.name);
		}
	};

	return (text, spans) => {
		if (spans.length === 0) return text;
		let out = '';
		let pos = 0;
		// The classifier merges overlapping spans; clamp anyway so a bad span can't expose or repeat text.
		for (const span of [...spans].sort((a, b) => a.start - b.start)) {
			const start = Math.max(span.start, pos);
			const end = Math.min(span.end, text.length);
			if (end <= start) continue;
			out += text.slice(pos, start) + replace(span, text.slice(start, end));
			pos = end;
		}
		return out + text.slice(pos);
	};
}
