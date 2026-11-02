/**
 * End-to-end: real Claude Code (`claude -p --output-format stream-json`) with and without the
 * plugin, against the real agent (SPEC.md §5, issue #17).
 *
 * Costs model usage, so it is NOT part of `pnpm test`. Run it with `pnpm test:e2e`. Needs
 * `claude` on PATH, signed in, v2.1.295+ (for `onFailure`).
 *
 * Four `claude -p` runs on haiku; only two reach the model (the blocked ones cost nothing):
 *   1. no plugin:   a prompt with a fake secret and email asks Claude to read a file holding
 *                   them → the prompt reaches Claude and Read/Bash return the raw values.
 *   2. plugin:      the same prompt → blocked by the agent before Claude sees it.
 *   3. plugin:      a clean prompt asking for the same reads → Claude sees cleaned output.
 *   4. plugin, agent down: SessionStart warns how to fix it, and the prompt is blocked.
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

interface StreamEvent {
	type: string;
	subtype?: string;
	[key: string]: unknown;
}

interface Run {
	events: StreamEvent[];
	/** The text of every tool result Claude received, in order. */
	toolResults: string[];
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
function claude(prompt: string, opts: { plugin?: string; port?: number } = {}): Promise<Run> {
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
	const toolResults: string[] = [];
	for (const e of events) {
		if (e.type !== 'user') continue;
		const content = (e.message as { content?: unknown })?.content;
		if (!Array.isArray(content)) continue;
		for (const block of content) {
			if (block?.type === 'tool_result') toolResults.push(textOf(block.content));
		}
	}
	return {
		events,
		toolResults,
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
