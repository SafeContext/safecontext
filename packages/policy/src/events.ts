import * as z from 'zod';
import { Action, Id } from './policy.ts';

export const HookEventName = z.enum(['UserPromptSubmit', 'PreToolUse', 'PostToolUse']);
export type HookEventName = z.infer<typeof HookEventName>;

const Count = z.number().int().nonnegative();

/**
 * One check the agent made, sent to the dashboard. METADATA ONLY.
 * Strict on purpose: any extra field (e.g. a stray `text` or `prompt`) is rejected.
 */
export const AgentEvent = z.strictObject({
	ts: z.iso.datetime(),
	/** Anonymised, stable per device. */
	deviceId: Id,
	policyVersion: z.number().int().nonnegative(),
	hookEvent: HookEventName,
	/** Claude Code tool name, e.g. "Read" or "mcp__slack__post". Absent for UserPromptSubmit. */
	toolName: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/).optional(),
	/** Spans found, per data type id. */
	counts: z.record(Id, Count),
	/** Spans handled, per action. */
	actions: z.partialRecord(Action, Count),
	/** True if the prompt or tool call was blocked. */
	blocked: z.boolean(),
	latencyMs: z.number().nonnegative()
});
export type AgentEvent = z.infer<typeof AgentEvent>;

/** What the agent uploads: a batch of events. */
export const AgentEventBatch = z.strictObject({
	events: z.array(AgentEvent).min(1).max(500)
});
export type AgentEventBatch = z.infer<typeof AgentEventBatch>;
