/**
 * Decision → hook output JSON, one function per hook. Pure: no I/O, no clock.
 *
 * - UserPromptSubmit can't rewrite the prompt, only block it (and must suppress the echo).
 * - PreToolUse: block = `deny`. Otherwise return `{}`, never `allow`: `allow` would skip the
 *   user's normal permission prompt.
 * - PostToolUse: block = replace every text field with a short notice, keeping the tool's shape
 *   (a mismatched shape is silently ignored by Claude Code, see tool-text.ts).
 */
import type { PostToolUseOutput, PreToolUseOutput, UserPromptSubmitOutput } from '@safecontext/policy';
import type { Decision } from './decide.ts';
import { messages } from './messages.ts';
import { mapToolOutputText } from './tool-text.ts';

export function promptResponse(decision: Decision): UserPromptSubmitOutput {
	if (decision.verdict === 'allow') return {};
	return {
		decision: 'block',
		reason: decision.cause === 'fail' ? messages.promptUnchecked() : messages.promptBlocked(decision.hits),
		hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true }
	};
}

export function toolInputResponse(decision: Decision): PreToolUseOutput {
	if (decision.verdict === 'allow') return {};
	return {
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason:
				decision.cause === 'fail' ? messages.toolInputUnchecked() : messages.toolInputBlocked(decision.hits)
		}
	};
}

export function toolOutputResponse(decision: Decision, toolName: string, toolResponse: unknown): PostToolUseOutput {
	if (decision.verdict === 'allow') return {};
	const notice =
		decision.cause === 'fail' ? messages.toolOutputUnchecked() : messages.toolOutputWithheld(decision.hits);
	return {
		hookSpecificOutput: {
			hookEventName: 'PostToolUse',
			updatedToolOutput: mapToolOutputText(toolName, toolResponse, () => notice)
		}
	};
}
