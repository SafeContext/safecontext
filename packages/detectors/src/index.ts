/**
 * Tier 0 detectors: deterministic rules (secrets, emails, card numbers) and admin term lists.
 * Fast (<10 ms), no ML. Tier 1 (label tagger) and tier 2 (small LLM) live in the agent.
 */

/** A flagged piece of text. Offsets are UTF-16 code unit indices into the input string. */
export type Span = {
	start: number;
	end: number;
	/** Policy data type id, or a built-in id such as "builtin:email". */
	dataTypeId: string;
	source: 'rule' | 'list' | 'tagger' | 'llm';
	/** 0..1. Rules and exact list matches are 1. */
	confidence: number;
};

export interface Detector {
	readonly id: string;
	detect(text: string): Span[];
}

// Starter rule so the package has a working, tested example. Replace/extend per SPEC.md.
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export const emailDetector: Detector = {
	id: 'builtin:email',
	detect(text) {
		return [...text.matchAll(EMAIL)].map((m) => ({
			start: m.index,
			end: m.index + m[0].length,
			dataTypeId: 'builtin:email',
			source: 'rule' as const,
			confidence: 1
		}));
	}
};
