/**
 * Decision → hook output JSON, one function per hook. Pure: no I/O, no clock. The rewritten text
 * (transform/) is worked out by the caller and passed in.
 *
 * - UserPromptSubmit can't rewrite the prompt, only block it (and must suppress the echo). The
 *   block reason includes a safe version the user can send instead.
 * - PreToolUse: block = `deny`. Real values put back into a local file tool's input
 *   (transform/restore.ts) go in `updatedInput`, with no `permissionDecision`, so the call still
 *   goes through the user's normal permission flow, now checked against the real input. A tool
 *   IT added to swap-back gets `ask` instead, so the user approves real values leaving the Mac.
 *   Never `allow`: it would skip the user's permission prompt. A swap-back that can't be done
 *   safely is a `deny` that tells Claude why. Otherwise `{}`.
 * - PostToolUse: each text field is replaced by its rewritten version, keeping the tool's shape
 *   (a mismatched shape is silently ignored by Claude Code, see tool-text.ts). If checking
 *   failed and the fail mode blocks, every text field becomes a short notice instead.
 */
import type { PostToolUseOutput, PreToolUseOutput, UserPromptSubmitOutput } from '@safecontext/policy';
import type { Decision } from './decide.ts';
import { messages } from './messages.ts';
import { mapToolOutputText } from './tool-text.ts';
import type { Restored } from './transform/restore.ts';

/** `safeVersion`: the prompt with every flagged span transformed (for a `block` decision). */
export function promptResponse(decision: Decision, safeVersion?: string): UserPromptSubmitOutput {
	// `rewrite` passes: a prompt can't be edited and yellow data doesn't stop it (issue #50).
	if (decision.verdict !== 'block') return {};
	return {
		decision: 'block',
		reason: decision.cause === 'fail' ? messages.promptUnchecked() : messages.promptBlocked(decision.hits, safeVersion),
		hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true }
	};
}

/** `restored`: the swap-back for this call (only looked at when the decision doesn't block it). */
export function toolInputResponse(decision: Decision, restored?: Restored, toolName?: string): PreToolUseOutput {
	if (decision.verdict === 'block') {
		return deny(decision.cause === 'fail' ? messages.toolInputUnchecked() : messages.toolInputBlocked(decision.hits));
	}
	// `rewrite` passes: Claude's own text isn't edited and yellow data doesn't stop it (issue #50).
	switch (restored?.kind) {
		case 'restored':
			// A tool IT added sends real values off the Mac: the user approves it (`ask`), which also
			// keeps it out of auto mode's safety check. Local file tools keep the normal flow.
			return {
				hookSpecificOutput: {
					hookEventName: 'PreToolUse',
					updatedInput: restored.input,
					...(restored.confirm && {
						permissionDecision: 'ask' as const,
						permissionDecisionReason: messages.restoreConfirm(toolName ?? 'tool', restored.count)
					})
				}
			};
		case 'refused':
			return deny(
				{
					unknown_placeholder: () => messages.restoreUnknown(restored.ids),
					outside_project: () => messages.restoreOutsideProject(),
					sandbox_escape: () => messages.restoreSandboxEscape()
				}[restored.reason]()
			);
		default:
			return {};
	}
}

function deny(reason: string): PreToolUseOutput {
	return {
		hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason }
	};
}

/**
 * `rewritten`: for a `rewrite` or `block` decision, the tool's text fields after transforming, in
 * `toolOutputTexts` order. Throws if they're missing or don't line up (the caller's fail mode applies).
 */
export function toolOutputResponse(
	decision: Decision,
	toolName: string,
	toolResponse: unknown,
	rewritten?: readonly string[]
): PostToolUseOutput {
	if (decision.verdict === 'allow') return {};
	let updatedToolOutput: unknown;
	if (decision.cause === 'fail') {
		const notice = messages.toolOutputUnchecked();
		updatedToolOutput = mapToolOutputText(toolName, toolResponse, () => notice);
	} else {
		let fields = 0;
		updatedToolOutput = mapToolOutputText(toolName, toolResponse, (_text, i) => (fields++, rewritten?.[i] ?? ''));
		if (rewritten?.length !== fields) throw new Error('rewritten tool output texts do not line up');
	}
	return { hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput } };
}
