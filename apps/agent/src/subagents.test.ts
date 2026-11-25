/** Subagent reports (#61): background reports arrive as prompts; handbacks as a tool call. */
import { AGENT_API } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { isTaskNotification } from './app.ts';
import { messages } from './messages.ts';
import { promptInput, testApp, toolInput } from './test-helpers.ts';

const { prompt, toolInput: preTool } = AGENT_API;
const email = 'jane.doe@northwind.example';
const notice = (summary: string) =>
	`<task-notification>\n<task-id>a1</task-id>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`;

describe('background subagent reports (#61)', () => {
	it('holds back a report with red data, saying it was a subagent report, with no safe version', async () => {
		const { post, reports, logger } = testApp();
		const out = prompt.response.parse((await post(prompt.path, promptInput(notice(`Contact: ${email}`)))).json);
		expect(out.decision).toBe('block');
		expect(out.reason).toBe(
			messages.subagentReportBlocked([
				{
					dataTypeId: 'customer-personal-data',
					name: 'Customer personal data',
					tier: 'red',
					action: 'pseudonymize',
					count: 1
				}
			])
		);
		expect(out.reason).not.toContain(email);
		expect(reports.at(-1)).toMatchObject({ hookEvent: 'UserPromptSubmit', blocked: true });
		expect(JSON.stringify([logger.records, reports])).not.toContain(email);
	});

	it('lets a clean report through, and keeps the usual message for typed prompts', async () => {
		const { post } = testApp();
		expect((await post(prompt.path, promptInput(notice('Read 3 files, all fine')))).json).toEqual({});
		const typed = prompt.response.parse((await post(prompt.path, promptInput(`Email ${email}`))).json);
		expect(typed.reason).toContain('blocked this prompt');
	});

	it('spots completion notices', () => {
		expect(isTaskNotification('  <task-notification>\n...')).toBe(true);
		expect(isTaskNotification('Please read <task-notification> docs')).toBe(false);
	});
});

describe('SubagentHandback (#61)', () => {
	it('cleans the report Claude hands back, instead of stopping it', async () => {
		const { post, reports } = testApp();
		const res = await post(
			preTool.path,
			toolInput('SubagentHandback', { message: `Found the owner: ${email}. Done.`, extra: 1 })
		);
		const out = preTool.response.parse(res.json).hookSpecificOutput;
		expect(out?.permissionDecision).toBeUndefined();
		expect(out?.updatedInput).toEqual({ message: 'Found the owner: ⟪customer_personal_data_1⟫. Done.', extra: 1 });
		expect(reports.at(-1)).toMatchObject({ blocked: false });
	});

	it('leaves a clean handback alone', async () => {
		const { post } = testApp();
		expect((await post(preTool.path, toolInput('SubagentHandback', { message: 'All tests pass.' }))).json).toEqual({});
	});
});
