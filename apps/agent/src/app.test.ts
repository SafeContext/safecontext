import { AGENT_API, AgentEvent, defaultPolicy } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { messages, SAFE_VERSION_MAX_CHARS } from './messages.ts';
import {
	CANARY,
	fakeTier,
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
import { createTier0 } from './classifier/tier0.ts';

const { prompt, toolInput: preTool, toolOutput: postTool } = AGENT_API;
const REMOVED_SECRET = '⟪secret_1⟫';

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
	const REVENUE = '$4.2M'; // generalize (the number rule)
	const EMAIL = 'jane@northwind.example'; // mask
	const replacements: Array<[string, string]> = [
		[CUSTOMER, '⟪customer_name_1⟫'],
		[REVENUE, '⟪revenue_figure_1: over $4M⟫'],
		[EMAIL, '⟪customer_personal_data_1: ****mple⟫'],
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
		expect(text).toMatch(/⟪customer_personal_data_\d+⟫/);
	});

	it('keeps placeholders consistent within a session, and separate between sessions', async () => {
		const { post } = testApp({ tiers: [termTier({ Northwind: 'customer-names', Fabrikam: 'customer-names' })] });
		const send = async (session: string, stdout: string) => {
			const body = { ...toolOutput('Bash', { stdout, stderr: '' }), session_id: session };
			const res = await post(postTool.path, body);
			return (postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput as { stdout: string }).stdout;
		};
		expect(await send('a', 'Northwind and Fabrikam')).toBe('⟪customer_name_1⟫ and ⟪customer_name_2⟫');
		expect(await send('a', 'Fabrikam, then Northwind')).toBe('⟪customer_name_2⟫, then ⟪customer_name_1⟫');
		expect(await send('b', 'Fabrikam')).toBe('⟪customer_name_1⟫');
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
		expect(out.reason).toContain(`\n\nemail ⟪customer_personal_data_1⟫ about key ${REMOVED_SECRET}`);
		expect(out.reason).not.toContain(email);
		expect(out.reason).not.toContain(SECRET);
	});

	it('uses the same placeholders in the safe version as in later tool output', async () => {
		const { post } = testApp();
		await post(prompt.path, promptInput(`write to ${email}`));
		const res = await post(postTool.path, toolOutput('Bash', { stdout: `sent to ${email}`, stderr: '' }));
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toMatchObject({
			stdout: 'sent to ⟪customer_personal_data_1⟫'
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

describe('swap-back and re-hiding (issue #83)', () => {
	// Flags "Northwind" only in the CRM export, like a tagger that needs context.
	const contextTier = fakeTier({
		id: 'context',
		spans: (texts) =>
			texts.map((t) =>
				t.startsWith('CRM') && t.includes('Northwind')
					? [
							{
								start: t.indexOf('Northwind'),
								end: t.indexOf('Northwind') + 9,
								dataTypeId: 'customer-names',
								source: 'tagger' as const,
								confidence: 0.9
							}
						]
					: []
			)
	});
	const readCrm = (post: ReturnType<typeof testApp>['post']) =>
		post(postTool.path, toolOutput('Bash', { stdout: 'CRM: Northwind renews in March', stderr: '' }));

	it('puts the real value into a local file tool, with no permission decision', async () => {
		const { post } = testApp({ tiers: [createTier0(), contextTier] });
		await readCrm(post);
		const res = await post(
			preTool.path,
			toolInput('Write', { file_path: 'notes.md', content: 'Call ⟪customer_name_1⟫ on Monday' })
		);
		expect(preTool.response.parse(res.json)).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				updatedInput: { file_path: 'notes.md', content: 'Call Northwind on Monday' }
			}
		});
	});

	it('leaves the placeholder in a shell command', async () => {
		const { post } = testApp({ tiers: [createTier0(), contextTier] });
		await readCrm(post);
		const res = await post(preTool.path, toolInput('Bash', { command: 'grep ⟪customer_name_1⟫ crm.csv' }));
		expect(res.json).toEqual({});
	});

	it("denies a file tool whose placeholder it doesn't hold, and says why", async () => {
		const { post } = testApp();
		const res = await post(preTool.path, toolInput('Read', { file_path: 'deals/⟪customer_name_1⟫.md' }));
		const out = preTool.response.parse(res.json).hookSpecificOutput;
		expect(out?.permissionDecision).toBe('deny');
		expect(out?.permissionDecisionReason).toBe(messages.restoreUnknown(['customer_name_1']));
	});

	it('denies a write of real values outside the project', async () => {
		const { post } = testApp({ tiers: [createTier0(), contextTier] });
		await readCrm(post);
		const res = await post(preTool.path, toolInput('Write', { file_path: '/tmp/x.md', content: '⟪customer_name_1⟫' }));
		expect(preTool.response.parse(res.json).hookSpecificOutput?.permissionDecisionReason).toBe(
			messages.restoreOutsideProject()
		);
	});

	it('still blocks red data Claude wrote itself, before any swap-back', async () => {
		const { post } = testApp({ tiers: [createTier0(), contextTier] });
		await readCrm(post);
		const res = await post(
			preTool.path,
			toolInput('Write', { file_path: 'a.md', content: `⟪customer_name_1⟫ ${SECRET}` })
		);
		expect(preTool.response.parse(res.json).hookSpecificOutput?.permissionDecisionReason).toBe(
			messages.toolInputBlocked([
				{ dataTypeId: 'secrets', name: 'API keys & secrets', tier: 'red', action: 'block', count: 1 }
			])
		);
	});

	it('hides a known value again wherever it comes back, even where no tier flags it', async () => {
		const { post } = testApp({ tiers: [createTier0(), contextTier] });
		await readCrm(post);
		// The Write result echoes the file, now holding the real value, without the CRM context.
		const res = await post(
			postTool.path,
			toolOutput('Write', { type: 'create', filePath: '/work/project/notes.md', content: 'Call Northwind on Monday' })
		);
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toEqual({
			type: 'create',
			filePath: '/work/project/notes.md',
			content: 'Call ⟪customer_name_1⟫ on Monday'
		});
	});

	it("doesn't flag a placeholder again", async () => {
		const { post } = testApp({ tiers: [createTier0(), termTier({ customer: 'customer-names' })] });
		const res = await post(postTool.path, toolOutput('Bash', { stdout: 'was ⟪customer_name_1⟫', stderr: '' }));
		expect(res.json).toEqual({});
	});

	it('logs how many values were put back, never the values', async () => {
		const { post, logger } = testApp({ tiers: [createTier0(), contextTier] });
		await readCrm(post);
		await post(
			preTool.path,
			toolInput('Edit', { file_path: 'a.md', old_string: '⟪customer_name_1⟫', new_string: 'x' })
		);
		const line = logger.records.find((r) => r.hook === 'PreToolUse');
		expect(line).toMatchObject({ restored: 1 });
		expect(JSON.stringify(logger.records)).not.toContain('Northwind');
	});
});

describe('swap-back tools from the policy (issue #83)', () => {
	const contextTier = termTier({ Northwind: 'customer-names' });
	const withSlack = policyWith({ swapBack: { tools: ['Read', 'mcp__slack__*'] } });

	it('asks the user before real values go into a tool IT added, and says why', async () => {
		const { post } = testApp({ policy: withSlack, tiers: [createTier0(), contextTier] });
		await post(postTool.path, toolOutput('Bash', { stdout: 'Northwind renews', stderr: '' }));
		const res = await post(
			preTool.path,
			toolInput('mcp__slack__send_message', { channel: 'sales', text: 'Call ⟪customer_name_1⟫' })
		);
		expect(preTool.response.parse(res.json)).toEqual({
			hookSpecificOutput: {
				hookEventName: 'PreToolUse',
				updatedInput: { channel: 'sales', text: 'Call Northwind' },
				permissionDecision: 'ask',
				permissionDecisionReason: messages.restoreConfirm('mcp__slack__send_message', 1)
			}
		});
	});

	it('leaves out a local tool the policy took off the list', async () => {
		const { post } = testApp({ policy: withSlack, tiers: [createTier0(), contextTier] });
		await post(postTool.path, toolOutput('Bash', { stdout: 'Northwind renews', stderr: '' }));
		const res = await post(preTool.path, toolInput('Write', { file_path: 'a.md', content: '⟪customer_name_1⟫' }));
		expect(res.json).toEqual({});
	});
});

describe('GET /v1/session-start (issue #83)', () => {
	it('tells Claude how placeholders work and which tools get real values, from the policy', async () => {
		const { app } = testApp({ policy: policyWith({ swapBack: { tools: ['Read', 'Write', 'mcp__slack__*'] } }) });
		const out = AGENT_API.sessionStart.response.parse(await (await app.request(AGENT_API.sessionStart.path)).json());
		const text = out.hookSpecificOutput.additionalContext;
		expect(text).toContain('In Read and Write calls, file paths included');
		expect(text).toContain('these tools: any tool whose name starts with mcp__slack__. The user is asked to approve');
		expect(text).toContain(
			'Shell commands, web tools, other MCP tools and subagent prompts get the placeholder exactly as you wrote it'
		);
	});

	it('lists the local file tools by default', async () => {
		const { app } = testApp();
		const out = AGENT_API.sessionStart.response.parse(await (await app.request(AGENT_API.sessionStart.path)).json());
		expect(out.hookSpecificOutput.additionalContext).toContain(
			'In Read, Write, Edit, MultiEdit, NotebookEdit, Glob and Grep calls'
		);
		expect(out.hookSpecificOutput.additionalContext).not.toContain("Your company's policy also");
	});
});
