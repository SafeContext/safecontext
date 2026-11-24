/** Skills and slash commands (#42): the skill's own file is checked before it runs. */
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_API } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { messages } from './messages.ts';
import { injectsShell, shellAllowed, skillFiles } from './skills.ts';
import { policyWith, testApp, toolInput } from './test-helpers.ts';

const { promptExpansion, toolInput: preTool } = AGENT_API;
const key = `AKIA${'IOSFODNN7EXAMPLE'}`;

/** A project with `.claude/skills/<name>/SKILL.md` and `.claude/commands/<name>.md` files. */
function project(files: Record<string, string>) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), 'sc-skills-')));
	for (const [rel, text] of Object.entries(files)) {
		mkdirSync(join(dir, rel, '..'), { recursive: true });
		writeFileSync(join(dir, rel), text);
	}
	return dir;
}

const expansion = (cwd: string, command_name: string, expansion_type = 'slash_command') => ({
	session_id: 'S',
	cwd,
	hook_event_name: 'UserPromptExpansion',
	expansion_type,
	command_name,
	command_args: '',
	prompt: `/${command_name}`
});

describe('skills and slash commands (#42)', () => {
	const dir = project({
		'.claude/skills/deploy-brief/SKILL.md': `---\nname: deploy-brief\n---\nUse the staging key ${key}.`,
		'.claude/skills/status-report/SKILL.md': 'Today:\n!`git log --oneline -5`\nSummarise it.',
		'.claude/skills/tidy/SKILL.md': 'Tidy the imports in the file the user names.',
		'.claude/commands/frontend/component.md': 'Make a component. Contact jane.doe@northwind.example.'
	});

	it('blocks a typed skill whose text holds a secret, naming only the data type', async () => {
		const { post, reports } = testApp();
		const out = promptExpansion.response.parse((await post(promptExpansion.path, expansion(dir, 'deploy-brief'))).json);
		expect(out.decision).toBe('block');
		expect(out.reason).toContain('/deploy-brief');
		expect(out.reason).toContain('API keys & secrets');
		expect(out.reason).not.toContain(key);
		expect(reports.at(-1)).toMatchObject({ hookEvent: 'UserPromptSubmit', blocked: true });
	});

	it('finds a command in a subfolder (frontend:component)', async () => {
		const out = promptExpansion.response.parse(
			(await testApp().post(promptExpansion.path, expansion(dir, 'frontend:component'))).json
		);
		expect(out).toMatchObject({ decision: 'block', reason: expect.stringContaining('Customer personal data') });
	});

	it('blocks a skill that injects shell output, unless IT allows it by name', async () => {
		const blocked = await testApp().post(promptExpansion.path, expansion(dir, 'status-report'));
		expect(promptExpansion.response.parse(blocked.json)).toEqual({
			decision: 'block',
			reason: messages.skillRunsCommands('status-report')
		});
		const allowed = testApp({ policy: policyWith({ shellSkills: ['Status-Report'] }) });
		expect((await allowed.post(promptExpansion.path, expansion(dir, 'status-report'))).json).toEqual({});
	});

	it('lets a clean skill, an unknown one and MCP prompts run', async () => {
		const { post } = testApp();
		expect((await post(promptExpansion.path, expansion(dir, 'tidy'))).json).toEqual({});
		expect((await post(promptExpansion.path, expansion(dir, 'no-such-skill'))).json).toEqual({});
		expect((await post(promptExpansion.path, expansion(dir, 'server:prompt', 'mcp_prompt'))).json).toEqual({});
	});

	it("denies Claude's own Skill call to a skill holding a secret", async () => {
		const { post } = testApp();
		const res = await post(preTool.path, { ...toolInput('Skill', { skill: 'deploy-brief' }), cwd: dir });
		expect(preTool.response.parse(res.json).hookSpecificOutput).toMatchObject({
			permissionDecision: 'deny',
			permissionDecisionReason: expect.stringContaining('API keys & secrets')
		});
		const ok = await post(preTool.path, { ...toolInput('Skill', { skill: 'tidy' }), cwd: dir });
		expect(ok.json).toEqual({});
	});

	it('finds skill files in the project, its parents and the home folder, and plugin skills', () => {
		const home = project({
			'.claude/skills/mine/SKILL.md': 'x',
			'.claude/plugins/cache/market/acme/1.0.0/skills/review/SKILL.md': 'y'
		});
		const nested = join(dir, 'src', 'deep');
		mkdirSync(nested, { recursive: true });
		expect(skillFiles('deploy-brief', nested, home)).toEqual([join(dir, '.claude/skills/deploy-brief/SKILL.md')]);
		expect(skillFiles('mine', dir, home)).toEqual([join(home, '.claude/skills/mine/SKILL.md')]);
		expect(skillFiles('acme:review', dir, home)).toEqual([
			join(home, '.claude/plugins/cache/market/acme/1.0.0/skills/review/SKILL.md')
		]);
		expect(skillFiles('../etc', dir, home)).toEqual([]);
	});

	it('spots shell injection the way Claude Code runs it', () => {
		expect(injectsShell('Now:\n!`date`')).toBe(true);
		expect(injectsShell('Run ```!\nls\n```')).toBe(false);
		expect(injectsShell('```!\nls\n```')).toBe(true);
		expect(injectsShell('Say hi! `code` here')).toBe(false);
		expect(injectsShell('a!`b`')).toBe(false);
	});

	it("always allows Safe Context's own status skill", () => {
		expect(shellAllowed([], 'safe-context:status')).toBe(true);
		expect(shellAllowed([], 'other:status')).toBe(false);
	});
});
