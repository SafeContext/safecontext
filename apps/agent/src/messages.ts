/**
 * Text the agent sends back: block reasons for the user, and notices Claude sees in place of
 * withheld output or a tool call it can't make. They name data types (admin-written labels) and
 * placeholders, and never quote the flagged text. The one exception by design is the prompt's
 * "safe version": the user's own prompt with every flagged span already replaced. Placeholders
 * themselves are made in transform/placeholders.ts.
 */
import { LOCAL_SWAP_BACK_TOOLS, swapsBackInto } from '@safecontext/policy';
import { stopsPromptsAndToolCalls, type Hit } from './decide.ts';

const PRODUCT = 'Safe Context';

/** Longer safe versions are left out of the block reason (it's shown in the terminal). */
export const SAFE_VERSION_MAX_CHARS = 10_000;

function listNames(hits: readonly Hit[]): string {
	const names = hits.filter(stopsPromptsAndToolCalls).map((h) => h.name);
	return (names.length > 0 ? names : hits.map((h) => h.name)).join(', ');
}

/** "a", "a and b", "a, b and c". */
function and(items: readonly string[]): string {
	return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** `mcp__slack__*` → "any tool whose name starts with mcp__slack__". */
function describePattern(pattern: string): string {
	return pattern.endsWith('*') ? `any tool whose name starts with ${pattern.slice(0, -1)}` : pattern;
}

/**
 * What Claude is told at session start (`GET /v1/session-start`, issue #83): what placeholders
 * mean, and which tools get real values back under this policy's `swapBack.tools`.
 */
function sessionContext(tools: readonly string[]): string {
	const local = LOCAL_SWAP_BACK_TOOLS.filter((t) => swapsBackInto(tools, t));
	const others = tools.filter((p) => !(LOCAL_SWAP_BACK_TOOLS as readonly string[]).includes(p));
	const parts = [
		`${PRODUCT} is on. It hides sensitive values in what you read behind placeholders such as ⟪customer_name_1⟫, or ⟪revenue_figure_1: over $4M⟫ where the text after the colon is a true hint. Each placeholder stands for one real value and stays the same for the whole session, so treat it as that value and copy it exactly, brackets included, whenever you need the value.`
	];
	if (local.length > 0) {
		parts.push(
			`In ${and(local)} calls, file paths included, ${PRODUCT} puts the real value back just before the tool runs and hides it again in the result: files get the real value, you keep seeing the placeholder.${local.some((t) => ['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(t)) ? ' Real values only go into files inside the project folder, not into hidden folders such as .git or .claude.' : ''}`
		);
	}
	if (others.length > 0) {
		parts.push(
			`Your company's policy also has real values put back into these tools: ${and(others.map(describePattern))}. The user is asked to approve each of those calls first, so only use a placeholder there when the real value is meant to go there.`
		);
	}
	if (local.length === 0 && others.length === 0) {
		parts.push(
			`${PRODUCT} doesn't put real values back into any tool: every tool gets the placeholder exactly as you wrote it.`
		);
	} else {
		const rest = [
			...(swapsBackInto(tools, 'Bash') ? [] : ['shell commands']),
			'web tools',
			...(others.some((p) => p.startsWith('mcp__')) ? ['other MCP tools'] : ['MCP tools']),
			'subagent prompts'
		];
		const useFileTools = local.includes('Read') && !swapsBackInto(tools, 'Bash');
		parts.push(
			`${and(rest).replace(/^./, (c) => c.toUpperCase())} get the placeholder exactly as you wrote it${useFileTools ? ', so use the file tools rather than the shell for files whose names or contents have placeholders' : ''}.`
		);
	}
	parts.push('Do not try to guess or work out hidden values.');
	return parts.join(' ');
}

export const messages = {
	sessionContext,
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
	restoreSandboxEscape: () =>
		`${PRODUCT} doesn't put hidden values back into a command that runs outside the sandbox: auto mode would send it off this Mac for a safety check. Nothing was run. Run it in the sandbox, or leave the placeholder out.`,
	restoreUnsupportedPath: () =>
		`${PRODUCT} couldn't establish a supported local file path for this call. Hidden values were not restored. Use an ordinary local path; network shares, device paths and ambiguous Windows names are not supported.`,
	/** Shown to the user in the permission prompt for a tool IT added to swap-back (transform/restore.ts). */
	restoreConfirm: (toolName: string, count: number) =>
		`${PRODUCT} put ${count === 1 ? 'a hidden value' : `${count} hidden values`} back into this ${toolName} call, as your company's policy allows. Claude never saw ${count === 1 ? 'it' : 'them'}. Approve only if ${count === 1 ? 'it is' : 'they are'} meant to go there.`,
	restoreOutsideProject: () =>
		`${PRODUCT} only puts hidden values back into files inside the project folder, and not into hidden folders such as .git or .claude (.env files are fine). Writes elsewhere can be sent off this Mac for a safety check. Nothing was written. Write to a file inside the project instead, or leave the placeholder out.`
};
