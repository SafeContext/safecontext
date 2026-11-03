/**
 * Applies each span's action to the text (SPEC.md §4):
 * - allow: unchanged
 * - mask: `****4242` (mask.ts)
 * - pseudonymize: `customer_name_1`, consistent within the session (pseudonyms.ts)
 * - generalize: a vague but true version ("$4.2M" → "over $4M", generalize.ts). When no safe
 *   rewrite can be made, `[Revenue figures]` (the data type's name).
 * - block: `[Safe Context removed: API keys & secrets]`
 *
 * Only the spans change; the text around them is kept exactly.
 */
import type { Span } from '@safecontext/detectors';
import type { Hit } from '../decide.ts';
import { messages } from '../messages.ts';
import { createGeneralize, type Generalize } from './generalize.ts';
import { mask } from './mask.ts';
import type { SessionPseudonyms } from './pseudonyms.ts';

/** Rewrites one text, given that text's spans. */
export type Rewriter = (text: string, spans: readonly Span[]) => Promise<string>;

/**
 * `hits` give each data type's action and name (summarize() already maps data types missing from
 * the policy to `block`). A span whose type isn't in `hits` is removed, to be safe.
 */
export function createRewriter(
	hits: readonly Hit[],
	pseudonyms: SessionPseudonyms,
	generalize: Generalize = createGeneralize()
): Rewriter {
	const byId = new Map(hits.map((h) => [h.dataTypeId, h]));

	const replace = (span: Span, value: string, vague: ReadonlyMap<Span, string>): string => {
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
				return vague.get(span) ?? messages.generalized(hit.name);
			case 'block':
				return messages.removed(hit.name);
		}
	};

	return async (text, spans) => {
		if (spans.length === 0) return text;
		// The classifier merges overlapping spans; clamp anyway so a bad span can't expose or repeat text.
		const clamped: Span[] = [];
		let pos = 0;
		for (const span of [...spans].sort((a, b) => a.start - b.start)) {
			const start = Math.max(span.start, pos);
			const end = Math.min(span.end, text.length);
			if (end <= start) continue;
			clamped.push({ ...span, start, end });
			pos = end;
		}
		const targets = clamped.filter((s) => byId.get(s.dataTypeId)?.action === 'generalize');
		const vague = targets.length > 0 ? await generalize(text, targets, clamped) : new Map<Span, string>();

		let out = '';
		pos = 0;
		for (const span of clamped) {
			out += text.slice(pos, span.start) + replace(span, text.slice(span.start, span.end), vague);
			pos = span.end;
		}
		return out + text.slice(pos);
	};
}
