/**
 * The local agent's HTTP API. Claude Code calls it through `http` hooks
 * (`plugin/hooks/hooks.json` must use these exact paths; a test checks this).
 * Each hook endpoint takes the hook's input JSON and returns the hook's output JSON.
 */
import * as z from 'zod';
import {
	PostToolUseInput,
	PostToolUseOutput,
	PreToolUseInput,
	PreToolUseOutput,
	UserPromptSubmitInput,
	UserPromptSubmitOutput
} from './hooks.ts';

/** Default port. Override with the SC_AGENT_PORT environment variable. */
export const AGENT_DEFAULT_PORT = 4747;
/** The agent only ever binds to loopback. */
export const AGENT_HOST = '127.0.0.1';

export const HealthResponse = z.strictObject({
	ok: z.boolean(),
	/** Version of the policy the agent is enforcing. */
	policyVersion: z.number().int().nonnegative()
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const AGENT_API = {
	health: { method: 'GET', path: '/health', response: HealthResponse },
	prompt: { method: 'POST', path: '/v1/prompt', request: UserPromptSubmitInput, response: UserPromptSubmitOutput },
	toolInput: { method: 'POST', path: '/v1/tool-input', request: PreToolUseInput, response: PreToolUseOutput },
	toolOutput: { method: 'POST', path: '/v1/tool-output', request: PostToolUseInput, response: PostToolUseOutput }
} as const;
