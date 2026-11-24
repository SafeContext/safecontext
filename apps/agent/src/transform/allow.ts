/**
 * "Always share" (#117): terms on the policy's `allow` list are never flagged by the models and
 * never re-hidden. Only model spans (tier 1 `tagger`, tier 2 `llm`) and re-hidden values are
 * dropped; rule matches and word-list matches stay, so a listed word can't unhide a secret, an
 * email or a term IT put on a word list.
 */
import type { Span } from '@safecontext/detectors';
import type { Policy } from '@safecontext/policy';

const cache = new WeakMap<Policy, (value: string) => boolean>();

/** `value` with case and surrounding spaces, quotes and punctuation ignored. */
const normalize = (value: string) =>
	value
		.trim()
		.replace(/^[\s"'`([{<]+|[\s"'`)\]}>.,;:!?]+$/g, '')
		.toLowerCase();

/** True if `value` is on the policy's always-share list. One lookup table per policy. */
export function allowedBy(policy: Policy): (value: string) => boolean {
	let allowed = cache.get(policy);
	if (!allowed) {
		const terms = new Set(policy.allow.map(normalize));
		allowed = terms.size === 0 ? () => false : (value) => terms.has(normalize(value));
		cache.set(policy, allowed);
	}
	return allowed;
}

/** `spans` without model spans whose text is on the always-share list. */
export function dropAllowedModelSpans(
	text: string,
	spans: readonly Span[],
	allowed: (value: string) => boolean
): Span[] {
	return spans.filter((s) => (s.source !== 'tagger' && s.source !== 'llm') || !allowed(text.slice(s.start, s.end)));
}
