/**
 * Text the agent sends back: block reasons for the user, and notices Claude sees in place of
 * withheld output or a tool call it can't make. They name data types (admin-written labels) and
 * placeholders, and never quote the flagged text. The one exception by design is the prompt's
 * "safe version": the user's own prompt with every flagged span already replaced. Placeholders
 * themselves are made in transform/placeholders.ts.
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
	/** Shown to Claude when a placeholder in a file tool's input can't be swapped back (transform/restore.ts). */
	restoreUnknown: (ids: readonly string[]) =>
		`${PRODUCT} can't put back the hidden value for ${ids.map((id) => `⟪${id}⟫`).join(', ')}: it no longer holds it (the Safe Context agent restarted, or the session is too old). Nothing was run. Read the file or output it came from again to get a current placeholder.`,
	restoreOutsideProject: () =>
		`${PRODUCT} only puts hidden values back into files inside the project folder, and not into hidden folders such as .git or .claude (.env files are fine). Writes elsewhere can be sent off this Mac for a safety check. Nothing was written. Write to a file inside the project instead, or leave the placeholder out.`
};
