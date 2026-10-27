/** SPEC.md §2a case 2: the agent is reachable but can't finish checking. `policy.failMode` decides. */
import { AGENT_API, type FailMode } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { createTier0 } from './classifier/tier0.ts';
import type { ClassifierTier } from './classifier/types.ts';
import { messages } from './messages.ts';
import { fakeTier, policyWith, promptInput, testApp, toolInput, toolOutput } from './test-helpers.ts';

const { prompt, toolInput: preTool, toolOutput: postTool } = AGENT_API;

const failures: Array<[string, { tiers: ClassifierTier[]; budgetMs?: number }]> = [
	['a tier throws', { tiers: [createTier0(), fakeTier({ throws: true })] }],
	['a tier runs past the budget', { tiers: [createTier0(), fakeTier({ ms: 200 })], budgetMs: 20 }],
	['a tier needs more budget than is left', { tiers: [{ ...fakeTier({}), minBudgetMs: 5_000 }], budgetMs: 1_000 }]
];

describe.each(failures)('when %s', (_name, setup) => {
	const app = (failMode: FailMode) => testApp({ ...setup, policy: policyWith({ failMode }) });

	it('block: blocks the prompt', async () => {
		const res = await app('block').post(prompt.path, promptInput('hello'));
		expect(res.status).toBe(200);
		expect(prompt.response.parse(res.json)).toEqual({
			decision: 'block',
			reason: messages.promptUnchecked(),
			hookSpecificOutput: { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true }
		});
	});

	it('block: denies the tool call', async () => {
		const res = await app('block').post(preTool.path, toolInput('Read', { file_path: '/a.txt' }));
		expect(preTool.response.parse(res.json).hookSpecificOutput).toEqual({
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: messages.toolInputUnchecked()
		});
	});

	it('block: withholds tool output with the "couldn\'t be checked" notice, same shape', async () => {
		const response = { stdout: 'hello', stderr: 'warn', interrupted: false, isImage: false, noOutputExpected: false };
		const res = await app('block').post(postTool.path, toolOutput('Bash', response));
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toEqual({
			...response,
			stdout: messages.toolOutputUnchecked(),
			stderr: messages.toolOutputUnchecked()
		});
	});

	it('allow: lets everything through with {}', async () => {
		const a = app('allow');
		expect((await a.post(prompt.path, promptInput('hello'))).json).toEqual({});
		expect((await a.post(preTool.path, toolInput('Read', { file_path: '/a.txt' }))).json).toEqual({});
		expect((await a.post(postTool.path, toolOutput('Bash', { stdout: 'x', stderr: '' }))).json).toEqual({});
	});

	it('logs the failure without text', async () => {
		const a = app('block');
		await a.post(prompt.path, promptInput('hello'));
		const check = a.logger.records.find((r) => r.msg === 'check');
		expect(check).toMatchObject({ outcome: 'fail_block' });
		expect(['error', 'timeout']).toContain(check?.failure);
	});
});

describe('answers well inside the budget when a tier hangs', () => {
	it('returns soon after the budget, not after the tier', async () => {
		const { post } = testApp({ tiers: [fakeTier({ ms: 2_000 })], budgetMs: 50 });
		const t0 = performance.now();
		const res = await post(prompt.path, promptInput('hello'));
		expect(performance.now() - t0).toBeLessThan(500);
		expect(res.json.decision).toBe('block');
	});
});

describe('invalid input', () => {
	it('block: blocks a prompt body that is not JSON', async () => {
		const { post, logger } = testApp();
		const res = await post(prompt.path, '{not json');
		expect(res.status).toBe(200);
		expect(prompt.response.parse(res.json).decision).toBe('block');
		expect(logger.records.find((r) => r.msg === 'check')).toMatchObject({
			outcome: 'fail_block',
			failure: 'invalid_input'
		});
	});

	it('block: denies a tool call with a missing field', async () => {
		const { post } = testApp();
		const { tool_use_id: _, ...body } = toolInput('Bash', { command: 'ls' });
		const res = await post(preTool.path, body);
		expect(preTool.response.parse(res.json).hookSpecificOutput?.permissionDecision).toBe('deny');
	});

	it('block: still withholds tool output when the tool response is there', async () => {
		const { post } = testApp();
		const { session_id: _, ...body } = toolOutput('Bash', { stdout: 'x', stderr: '' });
		const res = await post(postTool.path, body);
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toMatchObject({
			stdout: messages.toolOutputUnchecked()
		});
	});

	it('block: answers 400 when there is no tool output to replace', async () => {
		const { post } = testApp();
		const res = await post(postTool.path, { hook_event_name: 'PostToolUse' });
		expect(res.status).toBe(400);
	});

	it('allow: lets an invalid body through with {}', async () => {
		const { post } = testApp({ policy: policyWith({ failMode: 'allow' }) });
		expect((await post(prompt.path, '{not json')).json).toEqual({});
		expect((await post(postTool.path, { hook_event_name: 'PostToolUse' })).json).toEqual({});
	});
});

describe('actions not implemented yet (issue #10)', () => {
	const email = 'jane@northwind.example';

	it('block: a pseudonymize span (email) blocks the prompt via fail mode', async () => {
		const { post, logger } = testApp();
		const res = await post(prompt.path, promptInput(`email ${email}`));
		expect(prompt.response.parse(res.json).reason).toBe(messages.promptUnchecked());
		expect(logger.records.find((r) => r.msg === 'check')).toMatchObject({ failure: 'unsupported_action' });
	});

	it('allow: a pseudonymize span passes through', async () => {
		const { post } = testApp({ policy: policyWith({ failMode: 'allow' }) });
		expect((await post(prompt.path, promptInput(`email ${email}`))).json).toEqual({});
	});
});

describe('a span whose data type is not in the policy', () => {
	it('is blocked', async () => {
		const tier = fakeTier({
			spans: (texts) =>
				texts.map((t) => [{ start: 0, end: t.length, dataTypeId: 'mystery-type', source: 'tagger', confidence: 0.9 }])
		});
		const { post } = testApp({ tiers: [tier], policy: policyWith({ failMode: 'allow' }) });
		const res = await post(prompt.path, promptInput('hello'));
		expect(res.json.decision).toBe('block');
		expect(res.json.reason).toContain('mystery-type');
	});
});
