import { AGENT_API, AgentEvent, defaultPolicy } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { messages, SAFE_VERSION_MAX_CHARS } from './messages.ts';
import {
	CANARY,
	loadFixtures,
	policyWith,
	promptInput,
	SECRET,
	shapeOf,
	termTier,
	testApp,
	toolInput,
	toolOutput
} from './test-helpers.ts';
import { mapToolOutputText, toolOutputTexts } from './tool-text.ts';

const { prompt, toolInput: preTool, toolOutput: postTool } = AGENT_API;
const REMOVED_SECRET = '[Safe Context removed: API keys & secrets]';

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
		expect(out.reason).toContain(`deploy with token ${REMOVED_SECRET} please`);
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
	it.each(loadFixtures())('%s: output with nothing flagged returns {}', async (_name, fx) => {
		const { post } = testApp({ tiers: [termTier({})] });
		const res = await post(postTool.path, fx.postToolUseInput);
		expect(postTool.response.parse(res.json)).toEqual({});
	});

	// One value per action. A term-list style tier flags them; the policy sets personal data to mask.
	const CUSTOMER = 'Contoso Widgets'; // pseudonymize (also in the read, grep and mcp fixtures)
	const REVENUE = '$4.2M'; // generalize (stub)
	const EMAIL = 'jane@northwind.example'; // mask
	const replacements: Array<[string, string]> = [
		[CUSTOMER, 'customer_name_1'],
		[REVENUE, '[Revenue figures]'],
		[EMAIL, '****mple'],
		[SECRET, REMOVED_SECRET]
	];
	const maskPersonal = policyWith({
		dataTypes: defaultPolicy().dataTypes.map((d) =>
			d.id === 'customer-personal-data' ? { ...d, action: 'mask' as const } : d
		)
	});
	const terms = termTier({
		[CUSTOMER]: 'customer-names',
		[REVENUE]: 'revenue-figures',
		[EMAIL]: 'customer-personal-data',
		[SECRET]: 'secrets'
	});

	it.each(loadFixtures())('%s: rewrites only the flagged spans, per action, in the exact shape', async (_name, fx) => {
		const { post } = testApp({ policy: maskPersonal, tiers: [terms] });
		const original = fx.postToolUseInput.tool_response;
		// Plant one value per action in the last text field (for WebSearch, the written summary).
		const last = toolOutputTexts(fx.tool, original).length - 1;
		const planted = mapToolOutputText(fx.tool, original, (t, i) =>
			i === last ? `${t}\nCustomer ${CUSTOMER} (${EMAIL}) paid ${REVENUE}. Token: ${SECRET}` : t
		);

		const res = await post(postTool.path, { ...fx.postToolUseInput, tool_response: planted });
		const out = postTool.response.parse(res.json);
		const updated = out.hookSpecificOutput?.updatedToolOutput;
		expect(out.hookSpecificOutput?.hookEventName).toBe('PostToolUse');

		// Exactly the original response, with each flagged value swapped for its replacement.
		const expected = mapToolOutputText(fx.tool, planted, (t) =>
			replacements.reduce((s, [from, to]) => s.replaceAll(from, to), t)
		);
		expect(updated).toEqual(expected);
		expect(shapeOf(updated)).toEqual(shapeOf(original));
		for (const [value] of replacements) expect(JSON.stringify(updated)).not.toContain(value);
	});

	it.each(loadFixtures())('%s: tier 0 alone cleans a planted secret and email', async (_name, fx) => {
		const { post } = testApp();
		const original = fx.postToolUseInput.tool_response;
		const last = toolOutputTexts(fx.tool, original).length - 1;
		const planted = mapToolOutputText(fx.tool, original, (t, i) =>
			i === last ? `${t}\nmail ${EMAIL} token ${SECRET}` : t
		);
		const res = await post(postTool.path, { ...fx.postToolUseInput, tool_response: planted });
		const updated = postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput;
		expect(shapeOf(updated)).toEqual(shapeOf(original));
		const text = JSON.stringify(updated);
		expect(text).not.toContain(SECRET);
		expect(text).not.toContain(EMAIL);
		expect(text).toContain(REMOVED_SECRET);
		expect(text).toMatch(/customer_personal_data_\d+/);
	});

	it('keeps pseudonyms consistent within a session, and separate between sessions', async () => {
		const { post } = testApp({ tiers: [termTier({ Northwind: 'customer-names', Fabrikam: 'customer-names' })] });
		const send = async (session: string, stdout: string) => {
			const body = { ...toolOutput('Bash', { stdout, stderr: '' }), session_id: session };
			const res = await post(postTool.path, body);
			return (postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput as { stdout: string }).stdout;
		};
		expect(await send('a', 'Northwind and Fabrikam')).toBe('customer_name_1 and customer_name_2');
		expect(await send('a', 'Fabrikam, then Northwind')).toBe('customer_name_2, then customer_name_1');
		expect(await send('b', 'Fabrikam')).toBe('customer_name_1');
	});

	it('checks every string of an unknown tool and keeps its shape', async () => {
		const { post } = testApp();
		const response = { items: [{ note: `token ${SECRET}` }], count: 1, ok: true };
		const res = await post(postTool.path, toolOutput('SomeNewTool', response));
		const updated = postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput;
		expect(updated).toEqual({ items: [{ note: `token ${REMOVED_SECRET}` }], count: 1, ok: true });
	});
});

describe('prompts and tool input with data that can be transformed', () => {
	const email = 'jane@northwind.example';

	it('blocks a prompt with red data, and the reason carries the safe version', async () => {
		const { post } = testApp();
		const res = await post(prompt.path, promptInput(`email ${email} about key ${SECRET}`));
		const out = prompt.response.parse(res.json);
		expect(out.decision).toBe('block');
		expect(out.reason).toContain('API keys & secrets, Customer personal data');
		expect(out.reason).toContain(`\n\nemail customer_personal_data_1 about key ${REMOVED_SECRET}`);
		expect(out.reason).not.toContain(email);
		expect(out.reason).not.toContain(SECRET);
	});

	it('uses the same pseudonyms in the safe version as in later tool output', async () => {
		const { post } = testApp();
		await post(prompt.path, promptInput(`write to ${email}`));
		const res = await post(postTool.path, toolOutput('Bash', { stdout: `sent to ${email}`, stderr: '' }));
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toMatchObject({
			stdout: 'sent to customer_personal_data_1'
		});
	});

	it('leaves out a safe version that is too long to show', async () => {
		const { post } = testApp();
		const res = await post(prompt.path, promptInput(`${'x'.repeat(SAFE_VERSION_MAX_CHARS)} ${SECRET}`));
		const reason = prompt.response.parse(res.json).reason;
		expect(reason).toBe(
			messages.promptBlocked([
				{ dataTypeId: 'secrets', name: 'API keys & secrets', tier: 'red', action: 'block', count: 1 }
			])
		);
	});

	// TEMPORARY rule, issue #50: yellow data doesn't stop a prompt or a tool call.
	it('lets yellow-only data through in prompts and tool input (issue #50)', async () => {
		const { post, reports } = testApp({
			tiers: [termTier({ Northwind: 'customer-names', '$4.2M': 'revenue-figures' })]
		});
		expect((await post(prompt.path, promptInput('Northwind paid $4.2M'))).json).toEqual({});
		expect((await post(preTool.path, toolInput('Bash', { command: 'echo Northwind' }))).json).toEqual({});
		expect(reports.map((r) => r.blocked)).toEqual([false, false]);
	});

	it('denies a tool call whose input has red data, even if its action is a transformation', async () => {
		const { post } = testApp();
		const res = await post(
			preTool.path,
			toolInput('WebFetch', { url: `https://x.example/?to=${email}`, prompt: 'summarise' })
		);
		const out = preTool.response.parse(res.json).hookSpecificOutput;
		expect(out?.permissionDecision).toBe('deny');
		expect(out?.permissionDecisionReason).toContain('Customer personal data');
		expect(out?.permissionDecisionReason).not.toContain(email);
	});
});

describe('logs and events', () => {
	it('never contain prompt or tool text, only counts and timings', async () => {
		const { post, logger, reports } = testApp();
		await post(prompt.path, promptInput(`${CANARY} ${SECRET} jane@northwind.example`));
		await post(preTool.path, toolInput('Bash', { command: `echo ${CANARY}` }));
		await post(postTool.path, toolOutput('Bash', { stdout: `${CANARY} ${SECRET} jane@northwind.example`, stderr: '' }));
		await post(prompt.path, `{"prompt": "${CANARY}", broken`);

		const all = JSON.stringify([logger.records, reports]);
		expect(all).not.toContain(CANARY);
		expect(all).not.toContain(SECRET);
		expect(all).not.toContain('northwind');
		expect(all).not.toContain('customer_personal_data_1');
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
		await post(prompt.path, promptInput(`token ${SECRET}`));
		expect(reports).toHaveLength(2);
		const [output, promptEvent] = reports.map((r) => AgentEvent.parse({ ...r, deviceId: 'device-1' }));
		expect(output).toMatchObject({
			hookEvent: 'PostToolUse',
			toolName: 'Bash',
			counts: { secrets: 1 },
			actions: { block: 1 },
			// Tool output is cleaned, not stopped.
			blocked: false
		});
		expect(promptEvent).toMatchObject({ hookEvent: 'UserPromptSubmit', blocked: true });
	});
});
