import * as z from 'zod';

/** Lowercase kebab-case id, e.g. "customer-names". Also used as event keys, so never free text. */
export const Id = z
	.string()
	.regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'must be lowercase kebab-case, max 64 chars');

/** The traffic-light column a data type sits in on the dashboard. */
export const Tier = z.enum(['green', 'yellow', 'red']);
export type Tier = z.infer<typeof Tier>;

/**
 * What the agent does to a span of this data type. In tool output every hidden value becomes a
 * labelled placeholder, consistent per session (SPEC.md §4, issue #83); actions differ in the hint.
 * - allow: leave it.
 * - generalize: a true, vague hint ("$4.2M" -> "⟪revenue_figure_1: over $4M⟫"). Tier 2 for non-numbers.
 * - pseudonymize: no hint ("Northwind" -> "⟪customer_name_1⟫").
 * - mask: a safe fragment as the hint ("4242 4242 4242 4242" -> "⟪…_1: ****4242⟫").
 * - block: no hint, and prompts and tool calls holding it are stopped.
 */
export const Action = z.enum(['allow', 'generalize', 'pseudonymize', 'mask', 'block']);
export type Action = z.infer<typeof Action>;

/** An admin-defined data type, e.g. "Customer names" or "Revenue figures". */
export const DataType = z.strictObject({
	id: Id,
	name: z.string().min(1).max(80),
	/** Plain-language description. Also fed to the tier 1 tagger as the label description. */
	description: z.string().max(500),
	examples: z.array(z.string().max(200)).max(20).default([]),
	tier: Tier,
	action: Action
});
export type DataType = z.infer<typeof DataType>;

/** Exact-match terms an admin uploads (codenames, customer names). Matched by tier 0. */
export const TermList = z.strictObject({
	dataTypeId: Id,
	terms: z.array(z.string().min(1).max(200))
});
export type TermList = z.infer<typeof TermList>;

/**
 * Swap-back (SPEC.md §4, issue #83): the tools whose input gets real values put back in place of
 * placeholders just before they run.
 *
 * - `LOCAL_SWAP_BACK_TOOLS`, the default: built-in file tools that run on the Mac without a model.
 *   They run through the user's normal permission flow, and writes only get real values inside the
 *   project folder.
 * - Anything else IT adds (an MCP tool, `mcp__slack__*`, even `Bash`) sends real values somewhere
 *   off the Mac, so every such call asks the user first, showing the real values. Asking also keeps
 *   the call out of auto mode's safety check, a model at Anthropic that would otherwise see them.
 * - `NEVER_SWAP_BACK_TOOLS` can't be added: their input goes straight to an Anthropic model.
 *
 * A pattern is a tool name, or a prefix ending in `*` (`mcp__slack__*`, `mcp__*`).
 */
export const LOCAL_SWAP_BACK_TOOLS = ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep'] as const;
export const NEVER_SWAP_BACK_TOOLS = ['Agent', 'Task', 'WebFetch', 'WebSearch'] as const;

export const ToolPattern = z
	.string()
	.regex(/^[A-Za-z0-9_-]{1,128}\*?$/, 'must be a tool name, or a tool name prefix ending in *');
export type ToolPattern = z.infer<typeof ToolPattern>;

/** True if `toolName` is `pattern`, or starts with it when it ends in `*`. */
export function matchesToolPattern(pattern: string, toolName: string): boolean {
	return pattern.endsWith('*') ? toolName.startsWith(pattern.slice(0, -1)) : toolName === pattern;
}

/** True if real values may go back into `toolName` under these patterns. Never for `NEVER_SWAP_BACK_TOOLS`. */
export function swapsBackInto(patterns: readonly string[], toolName: string): boolean {
	if ((NEVER_SWAP_BACK_TOOLS as readonly string[]).includes(toolName)) return false;
	return patterns.some((p) => matchesToolPattern(p, toolName));
}

export const SwapBack = z
	.strictObject({
		tools: z
			.array(ToolPattern)
			.max(100)
			.default(() => [...LOCAL_SWAP_BACK_TOOLS])
	})
	.superRefine((swapBack, ctx) => {
		swapBack.tools.forEach((pattern, i) => {
			const never = NEVER_SWAP_BACK_TOOLS.find((tool) => matchesToolPattern(pattern, tool));
			if (never) {
				ctx.addIssue({
					code: 'custom',
					path: ['tools', i],
					message: `"${pattern}" would include ${never}, whose input goes to an Anthropic model, so real values can never go back into it`
				});
			}
		});
	});
export type SwapBack = z.infer<typeof SwapBack>;

/** What the agent does when it can't finish checking (error or time budget). See SPEC.md §2a. */
export const FailMode = z.enum(['block', 'allow']);
export type FailMode = z.infer<typeof FailMode>;

/**
 * A published policy. The dashboard creates a new `version` on every publish;
 * the agent keeps the highest version it has seen.
 */
export const Policy = z
	.strictObject({
		version: z.number().int().nonnegative(),
		updatedAt: z.iso.datetime(),
		dataTypes: z.array(DataType).min(1),
		lists: z.array(TermList).default([]),
		failMode: FailMode.default('block'),
		swapBack: SwapBack.default(() => ({ tools: [...LOCAL_SWAP_BACK_TOOLS] }))
	})
	.superRefine((policy, ctx) => {
		const ids = new Set<string>();
		policy.dataTypes.forEach((dt, i) => {
			if (ids.has(dt.id)) {
				ctx.addIssue({ code: 'custom', path: ['dataTypes', i, 'id'], message: `duplicate data type id "${dt.id}"` });
			}
			ids.add(dt.id);
			if ((dt.tier === 'green') !== (dt.action === 'allow')) {
				ctx.addIssue({
					code: 'custom',
					path: ['dataTypes', i, 'action'],
					message: 'green data types must use "allow", and only green data types may use it'
				});
			}
		});
		policy.lists.forEach((list, i) => {
			if (!ids.has(list.dataTypeId)) {
				ctx.addIssue({ code: 'custom', path: ['lists', i, 'dataTypeId'], message: `unknown data type "${list.dataTypeId}"` });
			}
		});
	});
export type Policy = z.infer<typeof Policy>;
export type PolicyInput = z.input<typeof Policy>;

/** True if `next` should replace `current` (the agent only moves forward). */
export function isNewerPolicy(current: Pick<Policy, 'version'> | undefined, next: Pick<Policy, 'version'>): boolean {
	return current === undefined || next.version > current.version;
}
