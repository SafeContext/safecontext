/**
 * Shared contracts for Safe Context. v0 DRAFT: refine as the product takes shape.
 *
 * - Policy: written by the dashboard, read by the agent.
 * - AgentEvent: sent by the agent to the dashboard. Metadata only, NEVER raw text.
 * - Hook I/O: the JSON Claude Code sends to / expects from hooks.
 *   Source: https://code.claude.com/docs/en/hooks
 */
import * as z from 'zod';

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** The traffic-light column a data type sits in on the dashboard. */
export const Tier = z.enum(['green', 'yellow', 'red']);
export type Tier = z.infer<typeof Tier>;

/** What the agent does to a span labelled with a data type. */
export const Action = z.enum(['allow', 'generalize', 'pseudonymize', 'mask', 'block']);
export type Action = z.infer<typeof Action>;

/** An admin-defined data type, e.g. "Customer names" or "Revenue figures". */
export const DataType = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	/** Plain-language description; also fed to the label tagger (tier 1). */
	description: z.string(),
	examples: z.array(z.string()).default([]),
	tier: Tier,
	action: Action
});
export type DataType = z.infer<typeof DataType>;

/** Exact-match terms an admin uploads (codenames, customer names). Tier 0. */
export const TermList = z.object({
	dataTypeId: z.string().min(1),
	terms: z.array(z.string().min(1))
});
export type TermList = z.infer<typeof TermList>;

export const Policy = z.object({
	version: z.number().int().nonnegative(),
	updatedAt: z.iso.datetime(),
	dataTypes: z.array(DataType),
	lists: z.array(TermList).default([]),
	/**
	 * What the agent does when it can't finish checking (internal error, model timeout).
	 * Default 'block'. Set by IT on the dashboard. See SPEC.md §2a.
	 */
	failMode: z.enum(['block', 'allow']).default('block')
});
export type Policy = z.infer<typeof Policy>;

// ---------------------------------------------------------------------------
// Events (agent -> dashboard). Metadata only. Never include prompt/file text.
// ---------------------------------------------------------------------------

export const HookEventName = z.enum(['UserPromptSubmit', 'PreToolUse', 'PostToolUse']);
export type HookEventName = z.infer<typeof HookEventName>;

export const AgentEvent = z.object({
	ts: z.iso.datetime(),
	/** Anonymised, stable per device. */
	deviceId: z.string().min(1),
	hookEvent: HookEventName,
	toolName: z.string().optional(),
	/** Count of spans found per data type id. */
	counts: z.record(z.string(), z.number().int().nonnegative()),
	/** Count of spans per action taken. */
	actions: z.record(z.string(), z.number().int().nonnegative()),
	blocked: z.boolean(),
	latencyMs: z.number().nonnegative()
});
export type AgentEvent = z.infer<typeof AgentEvent>;

// ---------------------------------------------------------------------------
// Claude Code hook I/O (subset we use). Inputs are loose: Claude Code may add fields.
// ---------------------------------------------------------------------------

const HookCommonInput = z.looseObject({
	session_id: z.string(),
	cwd: z.string(),
	hook_event_name: z.string()
});

export const UserPromptSubmitInput = HookCommonInput.extend({
	prompt: z.string()
});
export type UserPromptSubmitInput = z.infer<typeof UserPromptSubmitInput>;

export const PreToolUseInput = HookCommonInput.extend({
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()),
	tool_use_id: z.string()
});
export type PreToolUseInput = z.infer<typeof PreToolUseInput>;

export const PostToolUseInput = HookCommonInput.extend({
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()),
	/** The tool's structured output. Shape differs per tool. */
	tool_response: z.unknown(),
	tool_use_id: z.string()
});
export type PostToolUseInput = z.infer<typeof PostToolUseInput>;

/** UserPromptSubmit cannot rewrite the prompt. It can only block it (with a reason shown to the user). */
export type UserPromptSubmitOutput = {
	decision?: 'block';
	reason?: string;
};

/** PreToolUse: allow/deny/ask/defer, or rewrite the input (updatedInput replaces the WHOLE input object). */
export type PreToolUseOutput = {
	hookSpecificOutput: {
		hookEventName: 'PreToolUse';
		permissionDecision?: 'allow' | 'deny' | 'ask' | 'defer';
		permissionDecisionReason?: string;
		updatedInput?: Record<string, unknown>;
		additionalContext?: string;
	};
};

/**
 * PostToolUse: updatedToolOutput replaces what Claude sees. It MUST match the tool's output shape;
 * for built-in tools a mismatched value is silently ignored (i.e. raw data gets through).
 */
export type PostToolUseOutput = {
	hookSpecificOutput: {
		hookEventName: 'PostToolUse';
		updatedToolOutput?: unknown;
		additionalContext?: string;
	};
};
