/**
 * Text the agent sends back: block reasons for the user, notices Claude sees in place of
 * withheld output, and the markers that replace flagged spans. They name data types
 * (admin-written labels) and never quote the flagged text. The one exception by design is the
 * prompt's "safe version": the user's own prompt with every flagged span already transformed.
 */
import { stopsPromptsAndToolCalls, type Hit } from './decide.ts';

const PRODUCT = 'Safe Context';

/** Longer safe versions are left out of the block reason (it's shown in the terminal). */
export const SAFE_VERSION_MAX_CHARS = 10_000;

function listNames(hits: readonly Hit[]): string {
	const names = hits.filter(stopsPromptsAndToolCalls).map((h) => h.name);
	return (names.length > 0 ? names : hits.map((h) => h.name)).join(', ');
}

export const messages = {
	promptBlocked: (hits: readonly Hit[], safeVersion?: string) => {
		const head = `${PRODUCT} blocked this prompt because it contains: ${listNames(hits)}. Nothing was sent.`;
		if (safeVersion === undefined || safeVersion.length > SAFE_VERSION_MAX_CHARS) {
			return `${head} Remove that and send it again.`;
		}
		return `${head} You can send this safe version instead:\n\n${safeVersion}`;
	},
	promptUnchecked: () =>
		`${PRODUCT} couldn't check this prompt, so your company's policy blocked it. Try again in a moment. If it keeps happening, check that the Safe Context agent is running.`,
	toolInputBlocked: (hits: readonly Hit[]) =>
		`${PRODUCT} blocked this tool call because its input contains: ${listNames(hits)}.`,
	toolInputUnchecked: () => `${PRODUCT} couldn't check this tool call, so your company's policy blocked it.`,
	toolOutputUnchecked: () => `[${PRODUCT}: withheld because it couldn't be checked]`,
	/** Replaces a span whose action is `block`. */
	removed: (name: string) => `[${PRODUCT} removed: ${name}]`,
	/** Replaces a span whose action is `generalize`, until tier 2 (#16) writes a real vague version. */
	generalized: (name: string) => `[${name}]`
};
