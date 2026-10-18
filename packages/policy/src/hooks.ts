/**
 * Claude Code hook input/output (the subset we use).
 * Source: https://code.claude.com/docs/en/hooks. Re-check when upgrading Claude Code.
 *
 * Inputs are loose: Claude Code may add fields. Outputs are strict, so a typo in our
 * response fails our tests instead of being silently ignored by Claude Code.
 * An empty object `{}` means "allow / no change" for every hook.
 */
import * as z from 'zod';

const common = {
	session_id: z.string(),
	cwd: z.string()
};

// ---------------------------------------------------------------- inputs

export const UserPromptSubmitInput = z.looseObject({
	...common,
	hook_event_name: z.literal('UserPromptSubmit'),
	/** The submitted text. Pasted content arrives expanded. */
	prompt: z.string()
});
export type UserPromptSubmitInput = z.infer<typeof UserPromptSubmitInput>;

export const PreToolUseInput = z.looseObject({
	...common,
	hook_event_name: z.literal('PreToolUse'),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()),
	tool_use_id: z.string()
});
export type PreToolUseInput = z.infer<typeof PreToolUseInput>;

export const PostToolUseInput = z.looseObject({
	...common,
	hook_event_name: z.literal('PostToolUse'),
	tool_name: z.string(),
	tool_input: z.record(z.string(), z.unknown()),
	/** The tool's structured output. Shape differs per tool; see docs/hook-shapes.md (issue #3). */
	tool_response: z.unknown(),
	tool_use_id: z.string(),
	duration_ms: z.number().optional()
});
export type PostToolUseInput = z.infer<typeof PostToolUseInput>;

// ---------------------------------------------------------------- outputs

/**
 * UserPromptSubmit cannot rewrite the prompt. It can only block it.
 * When blocking, set `suppressOriginalPrompt: true` so the prompt text isn't echoed back.
 */
export const UserPromptSubmitOutput = z.strictObject({
	decision: z.literal('block').optional(),
	/** Shown to the user when blocking. Not added to Claude's context. */
	reason: z.string().optional(),
	hookSpecificOutput: z
		.strictObject({
			hookEventName: z.literal('UserPromptSubmit'),
			additionalContext: z.string().optional(),
			suppressOriginalPrompt: z.boolean().optional()
		})
		.optional()
});
export type UserPromptSubmitOutput = z.infer<typeof UserPromptSubmitOutput>;

/** PreToolUse: allow/deny/ask/defer, or rewrite the input (`updatedInput` replaces the WHOLE input). */
export const PreToolUseOutput = z.strictObject({
	hookSpecificOutput: z
		.strictObject({
			hookEventName: z.literal('PreToolUse'),
			permissionDecision: z.enum(['allow', 'deny', 'ask', 'defer']).optional(),
			permissionDecisionReason: z.string().optional(),
			updatedInput: z.record(z.string(), z.unknown()).optional(),
			additionalContext: z.string().optional()
		})
		.optional()
});
export type PreToolUseOutput = z.infer<typeof PreToolUseOutput>;

/**
 * PostToolUse: `updatedToolOutput` replaces what Claude sees. It MUST match the tool's output
 * shape; for built-in tools a mismatched value is silently ignored (raw data gets through).
 * Top-level `decision: "block"` does NOT hide the output; it only adds `reason` next to it.
 */
export const PostToolUseOutput = z.strictObject({
	decision: z.literal('block').optional(),
	reason: z.string().optional(),
	hookSpecificOutput: z
		.strictObject({
			hookEventName: z.literal('PostToolUse'),
			additionalContext: z.string().optional(),
			updatedToolOutput: z.unknown().optional()
		})
		.optional()
});
export type PostToolUseOutput = z.infer<typeof PostToolUseOutput>;
