/**
 * Text the agent sends back: block reasons for the user and notices Claude sees in place of
 * withheld output. They name data types (admin-written labels) and never quote the flagged text.
 */
import type { Hit } from './decide.ts';

const PRODUCT = 'Safe Context';

function listNames(hits: readonly Hit[]): string {
	const names = hits.filter((h) => h.action === 'block').map((h) => h.name);
	return (names.length > 0 ? names : hits.map((h) => h.name)).join(', ');
}

export const messages = {
	promptBlocked: (hits: readonly Hit[]) =>
		`${PRODUCT} blocked this prompt because it contains: ${listNames(hits)}. Remove that and send it again.`,
	promptUnchecked: () =>
		`${PRODUCT} couldn't check this prompt, so your company's policy blocked it. Try again in a moment. If it keeps happening, check that the Safe Context agent is running.`,
	toolInputBlocked: (hits: readonly Hit[]) =>
		`${PRODUCT} blocked this tool call because its input contains: ${listNames(hits)}.`,
	toolInputUnchecked: () => `${PRODUCT} couldn't check this tool call, so your company's policy blocked it.`,
	toolOutputWithheld: (hits: readonly Hit[]) => `[${PRODUCT}: withheld because it contains: ${listNames(hits)}]`,
	toolOutputUnchecked: () => `[${PRODUCT}: withheld because it couldn't be checked]`
};
