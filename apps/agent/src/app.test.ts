import { AGENT_API, AgentEvent } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { messages } from './messages.ts';
import {
	CANARY,
	loadFixtures,
	policyWith,
	promptInput,
	SECRET,
	shapeOf,
	testApp,
	toolInput,
	toolOutput
} from './test-helpers.ts';
import { mapToolOutputText, toolOutputTexts } from './tool-text.ts';

const { prompt, toolInput: preTool, toolOutput: postTool } = AGENT_API;

describe('GET /health', () => {
	it('returns a valid HealthResponse with the policy version', async () => {
		const { app } = testApp({ policy: policyWith({ version: 7 }) });
		const res = await app.request(AGENT_API.health.path);
		expect(res.status).toBe(200);
		const body = AGENT_API.health.response.parse(await res.json());
		expect(body).toEqual({ ok: true, policyVersion: 7 });
	});
});

describe('POST /v1/prompt', () => {
	it('allows a clean prompt with {}', async () => {
		const { post } = testApp();
		const res = await post(prompt.path, promptInput('Refactor the checkout handler to use async/await.'));
		expect(res.status).toBe(200);
		expect(prompt.response.parse(res.json)).toEqual({});
	});

	it('blocks a prompt with a secret, suppressing the echo and naming only the data type', async () => {
		const { post } = testApp();
		const res = await post(prompt.path, promptInput(`deploy with token ${SECRET} please`));
		const out = prompt.response.parse(res.json);
		expect(out.decision).toBe('block');
		expect(out.hookSpecificOutput).toEqual({ hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true });
		expect(out.reason).toContain('API keys & secrets');
		expect(out.reason).not.toContain(SECRET);
	});

	it('accepts extra input fields Claude Code adds', async () => {
		const { post } = testApp();
		const res = await post(prompt.path, {
			...promptInput('hello'),
			transcript_path: '/x',
			prompt_id: 'p',
			effort: { level: 'low' }
		});
		expect(res.json).toEqual({});
	});
});

describe('POST /v1/tool-input', () => {
	it('returns {} (never "allow") for a clean tool call', async () => {
		const { post } = testApp();
		const res = await post(preTool.path, toolInput('Bash', { command: 'ls -la', description: 'List files' }));
		expect(preTool.response.parse(res.json)).toEqual({});
	});

	it('denies a tool call whose input carries a secret, at any depth', async () => {
		const { post } = testApp();
		const res = await post(
			preTool.path,
			toolInput('mcp__slack__post', { message: { blocks: [{ text: `key ${SECRET}` }] } })
		);
		const out = preTool.response.parse(res.json);
		expect(out.hookSpecificOutput?.permissionDecision).toBe('deny');
		expect(out.hookSpecificOutput?.permissionDecisionReason).not.toContain(SECRET);
	});

	it.each(loadFixtures())('allows the real %s PreToolUse fixture', async (_name, fx) => {
		const { post } = testApp();
		const res = await post(preTool.path, fx.preToolUseInput);
		expect(preTool.response.parse(res.json)).toEqual({});
	});
});

describe('POST /v1/tool-output', () => {
	const failOpen = policyWith({ failMode: 'allow' });

	it.each(loadFixtures())('%s: clean output (fail mode allow) returns {}', async (_name, fx) => {
		// Read and MCP fixtures contain made-up emails (pseudonymize, issue #10), so use fail mode
		// "allow" to see the plain pass-through.
		const { post } = testApp({ policy: failOpen });
		const res = await post(postTool.path, fx.postToolUseInput);
		expect(postTool.response.parse(res.json)).toEqual({});
	});

	it.each(loadFixtures())('%s: a secret withholds every text field and keeps the exact shape', async (_name, fx) => {
		const { post } = testApp();
		const original = fx.postToolUseInput.tool_response;
		// Plant the secret in the last text field (for WebSearch, the written summary).
		const last = toolOutputTexts(fx.tool, original).length - 1;
		const response = mapToolOutputText(fx.tool, original, (t, i) => (i === last ? `${t}\n${SECRET}` : t));
		expect(toolOutputTexts(fx.tool, response).join('\n')).toContain(SECRET);

		const res = await post(postTool.path, { ...fx.postToolUseInput, tool_response: response });
		const out = postTool.response.parse(res.json);
		const updated = out.hookSpecificOutput?.updatedToolOutput;
		expect(out.hookSpecificOutput?.hookEventName).toBe('PostToolUse');
		expect(shapeOf(updated)).toEqual(shapeOf(response));
		expect(JSON.stringify(updated)).not.toContain(SECRET);
		for (const text of toolOutputTexts(fx.tool, updated)) {
			expect(text).toBe(
				messages.toolOutputWithheld([{ dataTypeId: 'secrets', name: 'API keys & secrets', action: 'block', count: 1 }])
			);
		}
	});

	it('checks every string of an unknown tool and keeps its shape', async () => {
		const { post } = testApp();
		const response = { items: [{ note: `token ${SECRET}` }], count: 1, ok: true };
		const res = await post(postTool.path, toolOutput('SomeNewTool', response));
		const updated = postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput;
		expect(shapeOf(updated)).toEqual(shapeOf(response));
		expect(JSON.stringify(updated)).not.toContain(SECRET);
		expect(updated).toMatchObject({ count: 1, ok: true });
	});
});

describe('logs and events', () => {
	it('never contain prompt or tool text, only counts and timings', async () => {
		const { post, logger, reports } = testApp();
		await post(prompt.path, promptInput(`${CANARY} ${SECRET}`));
		await post(preTool.path, toolInput('Bash', { command: `echo ${CANARY}` }));
		await post(postTool.path, toolOutput('Bash', { stdout: `${CANARY} ${SECRET}`, stderr: '' }));
		await post(prompt.path, `{"prompt": "${CANARY}", broken`);

		const all = JSON.stringify([logger.records, reports]);
		expect(all).not.toContain(CANARY);
		expect(all).not.toContain(SECRET);
		expect(all).not.toContain('SESSION_ID');
		expect(all).not.toContain('/work/project');
	});

	it('logs one check per request with timings and counts', async () => {
		const { post, logger } = testApp();
		await post(prompt.path, promptInput(`token ${SECRET}`));
		const check = logger.records.find((r) => r.msg === 'check');
		expect(check).toMatchObject({ hook: 'UserPromptSubmit', outcome: 'block', spans: 1, fields: 1, tiers: ['tier0'] });
		expect(check?.totalMs).toBeTypeOf('number');
	});

	it('records an AgentEvent-shaped report per request', async () => {
		const { post, reports } = testApp();
		await post(postTool.path, toolOutput('Bash', { stdout: `token ${SECRET}`, stderr: '' }));
		expect(reports).toHaveLength(1);
		const event = AgentEvent.parse({ ...reports[0], deviceId: 'device-1' });
		expect(event).toMatchObject({
			hookEvent: 'PostToolUse',
			toolName: 'Bash',
			counts: { secrets: 1 },
			actions: { block: 1 },
			blocked: true
		});
	});
});
