/**
 * Applies each span's action to the text (SPEC.md §4, issue #83). Every hidden value becomes a
 * labelled placeholder from the session's key (placeholders.ts), so Claude can see that it was
 * hidden, what kind of data it was and which one. Actions differ only in the hint after the colon:
 * - allow: unchanged
 * - pseudonymize, block: `⟪customer_name_1⟫`, `⟪secret_1⟫`
 * - mask: `⟪customer_personal_data_1: ****4242⟫` (mask.ts; no hint when too short to show any)
 * - generalize: `⟪revenue_figure_1: over $4M⟫`, a vague but true hint (generalize.ts); no hint
 *   when no safe one can be made
 *
 * Only the spans change; the text around them is kept exactly.
 */
import type { Span } from '@safecontext/detectors';
import type { Hit } from '../decide.ts';
import { createGeneralize, type Generalize } from './generalize.ts';
import { MASK, mask } from './mask.ts';
import { formatPlaceholder, type SessionKey } from './placeholders.ts';

/** Rewrites one text, given that text's spans. */
export type Rewriter = (text: string, spans: readonly Span[]) => Promise<string>;

/**
 * `hits` give each data type's action and name (summarize() already maps data types missing from
 * the policy to `block`). A span whose type isn't in `hits` is hidden, to be safe.
 */
export function createRewriter(
	hits: readonly Hit[],
	key: SessionKey,
	generalize: Generalize = createGeneralize()
): Rewriter {
	const byId = new Map(hits.map((h) => [h.dataTypeId, h]));
	/** The placeholder, with its hint noted in the key so this exact text isn't checked again. */
	const show = (id: string, hint?: string) => {
		if (hint) key.noteHint(id, hint);
		return formatPlaceholder(id, hint);
	};

	const replace = (span: Span, value: string, vague: ReadonlyMap<Span, string>): string => {
		const hit = byId.get(span.dataTypeId);
		if (hit?.action === 'allow') return value;
		const id = key.idFor(span.dataTypeId, value);
		switch (hit?.action) {
			case 'mask': {
				const masked = mask(value);
				return show(id, masked === MASK ? undefined : masked);
			}
			case 'generalize':
				return show(id, vague.get(span));
			default:
				return show(id);
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
