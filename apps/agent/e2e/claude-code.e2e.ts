/**
 * End-to-end: real Claude Code (`claude -p --output-format stream-json`) with and without the
 * plugin, against the real agent (SPEC.md §5, issue #17).
 *
 * Costs model usage, so it is NOT part of `pnpm test`. Run it with `pnpm test:e2e`. Needs
 * `claude` on PATH, signed in, v2.1.295+ (for `onFailure`).
 *
 * Six `claude -p` runs on haiku; only four reach the model (the blocked ones cost nothing):
 *   1. no plugin:   a prompt with a fake secret and email asks Claude to read a file holding
 *                   them → the prompt reaches Claude and Read/Bash return the raw values.
 *   2. plugin:      the same prompt → blocked by the agent before Claude sees it.
 *   3. plugin:      a clean prompt asking for the same reads → Claude sees cleaned output.
 *   4. plugin:      a subagent reads the file (Claude Code's default: in the background) → its
 *                   Read is cleaned, so its report to the main Claude is clean too (issue #41).
 *   5. plugin, foreground subagent: the subagent writes a fake email into its report itself (so
 *                   no Read hook sees it) → the hook on the Agent tool cleans the report.
 *   6. plugin, agent down: SessionStart warns how to fix it, and the prompt is blocked.
 *
 * All data is fake. Isolation: a temp working folder, `--setting-sources local` (no user or
 * project settings, so no other hooks or plugins), `--strict-mcp-config`, no session saved.
 * Port: the agent runs on a free port and the test points a copy of the plugin at it.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SECRET } from '../src/test-helpers.ts';
import { freePort, pluginOnPort, startAgent, withoutAgentEnv, type RunningAgent } from './helpers.ts';

/** Obviously fake contact (example.com is reserved for examples). */
const EMAIL = 'mh.canary.7731@example.com';
const NOTES = `Macrohard launch notes (fake test data)\nContact: ${EMAIL}\nDeploy token: ${SECRET}\n`;
const READS =
	'Use the Read tool to read notes.txt, then run `cat notes.txt` with the Bash tool, then reply with just DONE.';
const DIRTY_PROMPT = `${READS} For later, my contact is ${EMAIL} and the deploy token is ${SECRET}.`;
const SUBAGENT_READ =
	'Use the Agent tool (subagent_type "general-purpose") and tell the subagent: "Use the Read tool to read ' +
	'notes.txt, then reply with its exact contents and nothing else." Then reply with exactly what it returned.';
// The email in two halves: no prompt or tool input holds it whole, only the subagent's own reply.
const [EMAIL_USER, EMAIL_DOMAIN] = EMAIL.split('@') as [string, string];
const SUBAGENT_WRITES =
	'Use the Agent tool (subagent_type "general-purpose") and tell the subagent: "Use the Read tool to read ' +
	`notes.txt. Reply with its exact contents, then one last line: Owner: followed by ${EMAIL_USER} and ` +
	`@${EMAIL_DOMAIN} joined with no space." Then reply with just DONE.`;

interface StreamEvent {
	type: string;
	subtype?: string;
	[key: string]: unknown;
}

interface ToolResult {
	toolUseId: string;
	text: string;
}

interface Run {
	events: StreamEvent[];
	/** The text of every tool result the main Claude received, in order. */
	toolResults: string[];
	/** The same, with the tool call each one answers. */
	mainResults: ToolResult[];
	/** Tool results inside subagents (stream-json marks them with `parent_tool_use_id`). */
	subagentResults: ToolResult[];
	/** Every tool call the main Claude made. */
	mainToolUses: { id: string; name: string }[];
	/** The text of every assistant message from the main Claude. */
	mainText: string[];
	/** Background subagents' reports, from their completion notices. */
	notifications: string[];
	/** Whether the model answered at all (any assistant message). */
	reachedModel: boolean;
	result: StreamEvent | undefined;
	/** Every SessionStart hook's output. */
	sessionStart: string[];
	/** How Claude Code handled the prompt, from its "operation blocked by hook" notice, if any. */
	promptBlock: { kind: string; content: string } | undefined;
}

let work: string;
let agent: RunningAgent;
let pluginUp: string;
let pluginDown: string;
let downPort: number;

beforeAll(async () => {
	work = mkdtempSync(join(tmpdir(), 'safecontext-e2e-'));
	mkdirSync(join(work, 'project'));
	writeFileSync(join(work, 'project/notes.txt'), NOTES);
	agent = await startAgent();
	downPort = await freePort();
	pluginUp = pluginOnPort(join(work, 'plugin-up'), agent.port);
	pluginDown = pluginOnPort(join(work, 'plugin-down'), downPort);
}, 60_000);

afterAll(async () => {
	await agent?.stop();
	// E2E_KEEP=1 keeps the temp folder, with each run's stream-json, for debugging.
	if (process.env.E2E_KEEP) console.log(`kept ${work}`);
	else if (work) rmSync(work, { recursive: true, force: true });
});

let runs = 0;

/** Run `claude -p` in the temp project. `plugin` is a plugin dir; `port` is what SessionStart checks. */
function claude(
	prompt: string,
	opts: { plugin?: string; port?: number; env?: Record<string, string> } = {}
): Promise<Run> {
	const args = [
		'-p',
		prompt,
		'--model',
		'haiku',
		'--output-format',
		'stream-json',
		'--verbose',
		'--include-hook-events',
		'--max-turns',
		'4',
		'--setting-sources',
		'local',
		'--strict-mcp-config',
		'--no-session-persistence',
		'--allowedTools',
		'Read',
		'Bash(cat notes.txt)'
	];
	if (opts.plugin) args.push('--plugin-dir', opts.plugin);
	const env = withoutAgentEnv(process.env);
	if (opts.port !== undefined) env.SC_AGENT_PORT = String(opts.port);
	Object.assign(env, opts.env);

	return new Promise((resolve, reject) => {
		const child = spawn('claude', args, { cwd: join(work, 'project'), env, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (err += d));
		child.once('error', reject);
		child.once('exit', (code) => {
			const events = out
				.split('\n')
				.filter((l) => l.trim())
				.map((l) => JSON.parse(l) as StreamEvent);
			writeFileSync(join(work, `run-${++runs}.jsonl`), out);
			if (!events.length) return reject(new Error(`claude exited ${code} with no output: ${err.slice(0, 500)}`));
			resolve(summarise(events));
		});
	});
}

function summarise(events: StreamEvent[]): Run {
	const mainResults: ToolResult[] = [];
	const subagentResults: ToolResult[] = [];
	const mainToolUses: { id: string; name: string }[] = [];
	const mainText: string[] = [];
	for (const e of events) {
		if (e.type !== 'user' && e.type !== 'assistant') continue;
		const content = (e.message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		const inSubagent = typeof e.parent_tool_use_id === 'string';
		for (const block of content) {
			if (e.type === 'user' && block?.type === 'tool_result') {
				const result = { toolUseId: String(block.tool_use_id), text: textOf(block.content) };
				(inSubagent ? subagentResults : mainResults).push(result);
			} else if (e.type === 'assistant' && !inSubagent) {
				if (block?.type === 'tool_use') mainToolUses.push({ id: String(block.id), name: String(block.name) });
				if (block?.type === 'text') mainText.push(String(block.text));
			}
		}
	}
	return {
		events,
		toolResults: mainResults.map((r) => r.text),
		mainResults,
		subagentResults,
		mainToolUses,
		mainText,
		notifications: events.filter((e) => e.subtype === 'task_notification').map((e) => String(e.summary ?? '')),
		reachedModel: events.some((e) => e.type === 'assistant'),
		result: events.find((e) => e.type === 'result'),
		sessionStart: events
			.filter((e) => e.subtype === 'hook_response' && e.hook_event === 'SessionStart')
			.map((e) => String(e.output ?? '')),
		promptBlock: events
			.filter((e) => e.subtype === 'informational' && e.prompt_submit_outcome)
			.map((e) => ({
				kind: String((e.prompt_submit_outcome as { kind?: unknown }).kind),
				content: String(e.content ?? '')
			}))[0]
	};
}

/** Cleaned by the agent with the default policy: the email pseudonymized, the token removed. */
function expectCleaned(text: string) {
	expect(text).not.toContain(EMAIL);
	expect(text).not.toContain(SECRET);
	expect(text).toMatch(/customer_personal_data_\d+/);
	expect(text).toContain('[Safe Context removed: API keys & secrets]');
}

function textOf(content: unknown): string {
	if (typeof content === 'string') return content;
	if (Array.isArray(content)) return content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('\n');
	return '';
}

describe('Claude Code end to end', { timeout: 180_000 }, () => {
	it('without the plugin, raw data reaches Claude', async () => {
		const run = await claude(DIRTY_PROMPT);
		expect(run.reachedModel).toBe(true); // the prompt with the secret got to the model
		expect(run.toolResults.length).toBeGreaterThanOrEqual(2);
		for (const text of run.toolResults) {
			expect(text).toContain(EMAIL);
			expect(text).toContain(SECRET);
		}
	});

	it('with the plugin, a prompt with a secret is blocked before Claude sees it', async () => {
		const run = await claude(DIRTY_PROMPT, { plugin: pluginUp, port: agent.port });
		expect(run.reachedModel).toBe(false);
		expect(run.toolResults).toEqual([]);
		expect(run.promptBlock?.kind).toBe('blocked_by_hook');
		expect(run.promptBlock?.content).toContain(
			'Safe Context blocked this prompt because it contains: API keys & secrets, Customer personal data.'
		);
		// The message offers a safe version, with the values already swapped out.
		expect(run.promptBlock?.content).toMatch(/my contact is customer_personal_data_\d+ and the deploy token is \[Safe/);
		expect(run.promptBlock?.content).not.toContain(EMAIL);
		expect(run.promptBlock?.content).not.toContain(SECRET);
		// The healthy agent adds nothing at session start.
		expect(run.sessionStart.every((o) => o.trim() === '')).toBe(true);
	});

	it('with the plugin, what Claude reads is cleaned', async () => {
		const run = await claude(READS, { plugin: pluginUp, port: agent.port });
		expect(run.reachedModel).toBe(true);
		expect(run.toolResults.length).toBeGreaterThanOrEqual(2);
		for (const text of run.toolResults) {
			expect(text).not.toContain(EMAIL);
			expect(text).not.toContain(SECRET);
			expect(text).toMatch(/customer_personal_data_\d+/);
			expect(text).toContain('[Safe Context removed: API keys & secrets]');
			expect(text).toContain('Macrohard launch notes'); // the rest is untouched
		}
	});

	it('with the plugin, a fake secret read by a subagent never reaches the main Claude', async () => {
		const run = await claude(SUBAGENT_READ, { plugin: pluginUp, port: agent.port });
		expect(run.reachedModel).toBe(true);
		expect(run.mainToolUses.filter((t) => t.name === 'Agent')).toHaveLength(1);

		// Inside the subagent: its Read result is rewritten (updatedToolOutput applies there too).
		const reads = run.subagentResults.filter((r) => r.text.includes('Macrohard launch notes'));
		expect(reads.length).toBeGreaterThanOrEqual(1);
		for (const { text } of reads) expectCleaned(text);

		// The report reached the main Claude (as the Agent result, or as the completion notice of a
		// background subagent, Claude Code's default), and nothing the main Claude saw holds a raw value.
		const seen = [...run.mainResults.map((r) => r.text), ...run.notifications, ...run.mainText];
		expect(seen.join('\n')).toContain('Macrohard launch notes');
		for (const text of [...seen, ...run.subagentResults.map((r) => r.text), String(run.result?.result ?? '')]) {
			expect(text).not.toContain(EMAIL);
			expect(text).not.toContain(SECRET);
		}
	});

	it('with the plugin, a foreground subagent report is cleaned by the Agent hook', async () => {
		// Make Claude wait for the subagent, so its report comes back as the Agent tool result.
		const run = await claude(SUBAGENT_WRITES, {
			plugin: pluginUp,
			port: agent.port,
			env: { CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: '1' }
		});
		expect(run.reachedModel).toBe(true);
		const agentCalls = run.mainToolUses.filter((t) => t.name === 'Agent');
		expect(agentCalls).toHaveLength(1);
		const report = run.mainResults.find((r) => r.toolUseId === agentCalls[0]!.id)?.text ?? '';
		expect(report).toContain('Macrohard launch notes');
		expectCleaned(report);
		// The email the subagent wrote itself was replaced by the PostToolUse hook on Agent.
		expect(report).toMatch(/Owner: customer_personal_data_\d+/);
		expect(
			run.events.some(
				(e) =>
					e.subtype === 'hook_response' &&
					e.hook_name === 'PostToolUse:Agent' &&
					String(e.output).includes('updatedToolOutput')
			)
		).toBe(true);
	});

	it('with the plugin and no agent, the session start says how to fix it and prompts are blocked', async () => {
		const run = await claude(READS, { plugin: pluginDown, port: downPort });
		const warning = run.sessionStart.map((o) => JSON.parse(o).systemMessage).join('\n');
		expect(warning).toContain("Safe Context: the agent isn't running");
		expect(warning).toContain('Start the Safe Context agent');
		expect(run.reachedModel).toBe(false);
		expect(run.toolResults).toEqual([]);
		// Claude Code itself blocks: the plugin's `onFailure: "block"` (SPEC.md §2a, case 1).
		expect(run.promptBlock?.kind).toBe('no_verdict');
		expect(run.promptBlock?.content).toContain('blocking because onFailure is "block"');
	});
});
