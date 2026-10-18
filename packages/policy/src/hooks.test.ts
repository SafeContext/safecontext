import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AGENT_API, AGENT_DEFAULT_PORT, AGENT_HOST } from './api.ts';
import {
	PostToolUseInput,
	PostToolUseOutput,
	PreToolUseInput,
	PreToolUseOutput,
	UserPromptSubmitInput,
	UserPromptSubmitOutput
} from './hooks.ts';

const common = { session_id: 's1', cwd: '/repo', transcript_path: '/tmp/t.jsonl' };

describe('hook inputs', () => {
	it('parse real-looking inputs and keep unknown fields', () => {
		const p = UserPromptSubmitInput.parse({ ...common, hook_event_name: 'UserPromptSubmit', prompt: 'hi' });
		expect(p.transcript_path).toBe('/tmp/t.jsonl');
		expect(
			PreToolUseInput.safeParse({
				...common,
				hook_event_name: 'PreToolUse',
				tool_name: 'Read',
				tool_input: { file_path: '/repo/a.ts' },
				tool_use_id: 't1'
			}).success
		).toBe(true);
		expect(
			PostToolUseInput.safeParse({
				...common,
				hook_event_name: 'PostToolUse',
				tool_name: 'Bash',
				tool_input: { command: 'ls' },
				tool_response: { stdout: 'a.ts', stderr: '' },
				tool_use_id: 't2'
			}).success
		).toBe(true);
	});

	it('rejects the wrong hook event', () => {
		expect(UserPromptSubmitInput.safeParse({ ...common, hook_event_name: 'PreToolUse', prompt: 'x' }).success).toBe(false);
	});
});

describe('hook outputs', () => {
	it('accept "allow" ({}) for every hook', () => {
		for (const s of [UserPromptSubmitOutput, PreToolUseOutput, PostToolUseOutput]) {
			expect(s.safeParse({}).success).toBe(true);
		}
	});

	it('accept a privacy-preserving prompt block', () => {
		expect(
			UserPromptSubmitOutput.safeParse({
				decision: 'block',
				reason: 'Safe Context: 2 items need to be made safe.',
				hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true }
			}).success
		).toBe(true);
	});

	it('accept a tool deny and a tool output rewrite', () => {
		expect(
			PreToolUseOutput.safeParse({
				hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' }
			}).success
		).toBe(true);
		expect(
			PostToolUseOutput.safeParse({
				hookSpecificOutput: { hookEventName: 'PostToolUse', updatedToolOutput: { stdout: '[removed]' } }
			}).success
		).toBe(true);
	});

	it('reject typos and misplaced fields', () => {
		// suppressOriginalPrompt belongs inside hookSpecificOutput
		expect(UserPromptSubmitOutput.safeParse({ decision: 'block', suppressOriginalPrompt: true }).success).toBe(false);
		expect(PreToolUseOutput.safeParse({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'block' } }).success).toBe(false);
		expect(PostToolUseOutput.safeParse({ hookSpecificOutput: { hookEventName: 'PreToolUse' } }).success).toBe(false);
	});
});

describe('plugin hooks.json matches the agent API', () => {
	const hooks = JSON.parse(readFileSync(join(import.meta.dirname, '../../../plugin/hooks/hooks.json'), 'utf8')).hooks;
	const urlFor = (event: string) => hooks[event][0].hooks[0].url;
	const base = `http://${AGENT_HOST}:${AGENT_DEFAULT_PORT}`;

	it('uses the right URL for each hook', () => {
		expect(urlFor('UserPromptSubmit')).toBe(base + AGENT_API.prompt.path);
		expect(urlFor('PreToolUse')).toBe(base + AGENT_API.toolInput.path);
		expect(urlFor('PostToolUse')).toBe(base + AGENT_API.toolOutput.path);
	});

	it('fails closed where it matters', () => {
		expect(hooks.UserPromptSubmit[0].hooks[0].onFailure).toBe('block');
		expect(hooks.PreToolUse[0].hooks[0].onFailure).toBe('block');
	});
});
