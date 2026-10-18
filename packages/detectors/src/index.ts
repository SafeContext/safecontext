/**
 * Tier 0 detectors: deterministic rules (secrets, emails, card numbers) and admin term lists.
 * Fast (<10 ms), no ML. Tier 1 (label tagger) and tier 2 (small LLM) live in the agent.
 */
import { cardDetector, emailDetector, ipDetector, phoneDetector } from './personal-data.ts';
import { secretsDetector } from './secrets.ts';
import { mergeSpans } from './spans.ts';
import type { Detector, Span } from './types.ts';

export type { Detector, Span } from './types.ts';
export {
	PRIVATE_KEY_RULE_ID,
	SECRET_RULES,
	findPrivateKeys,
	secretsDetector,
	type SecretRule
} from './secrets.ts';
export {
	cardDetector,
	emailDetector,
	hasCardBrandShape,
	ipDetector,
	passesLuhn,
	phoneDetector
} from './personal-data.ts';
export { mergeSpans, ruleSpan } from './spans.ts';

/**
 * The built-in rule detectors, in precedence order: when two overlap with different data types
 * and equal confidence, the earlier one wins. Term lists (issue #8) add their own
 * detector: `detectAll(text, [...defaultDetectors, termListDetector])`.
 */
export const defaultDetectors: readonly Detector[] = [
	secretsDetector,
	cardDetector,
	emailDetector,
	phoneDetector,
	ipDetector
];

/**
 * Run every detector over `text` and merge overlapping spans (see `mergeSpans`).
 * Returns spans sorted by `start`, none overlapping.
 */
export function detectAll(text: string, detectors: readonly Detector[] = defaultDetectors): Span[] {
	return mergeSpans(detectors.flatMap((detector) => detector.detect(text)));
}
