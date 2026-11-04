/**
 * Sends every demo scenario through a running agent and checks the result.
 *
 *   node demo/check.ts                      # agent on 127.0.0.1:4747, personas in ~/macrohard
 *   node demo/check.ts --port 4799 --dir /tmp/macrohard
 *   node demo/check.ts --list               # print the "try these" guide (Markdown) instead
 *
 * Needs Node 24 (runs TypeScript directly) and the personas installed by demo/setup.sh, because
 * the fake keys are generated at install time.
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { SCENARIOS, type Persona, type Scenario } from './scenarios.ts';

const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i === -1 ? undefined : args[i + 1];
};
const port = Number(flag('--port') ?? 4747);
const dir = flag('--dir') ?? join(homedir(), 'macrohard');
/** In every message the agent gives when it couldn't finish a check (apps/agent/src/messages.ts). */
const unchecked = (text: string | undefined) => text !== undefined && /couldn't (?:be )?check/.test(text);

const PERSONA_TITLES: Record<Persona, string> = {
	dev: 'Dev: orders-api (`~/macrohard/dev`)',
	pm: 'PM: Priya Shah, Macrohard Flow (`~/macrohard/pm`)',
	sales: 'Sales: Marcus Reid, enterprise accounts (`~/macrohard/sales`)'
};

/** `__FAKE_STRIPE_KEY__` and friends → the fake values setup.sh wrote to dev/.env. */
function fakeKeys(): Record<string, string> {
	const env: Record<string, string> = {};
	try {
		for (const line of readFileSync(join(dir, 'dev', '.env'), 'utf8').split('\n')) {
			const m = /^([A-Z_]+)=(.*)$/.exec(line);
			if (m) env[m[1]!] = m[2]!;
		}
	} catch {
		// Not installed: placeholders stay as they are (only matters for the key scenarios).
	}
	return { __FAKE_STRIPE_KEY__: env['STRIPE_SECRET_KEY'] ?? '__FAKE_STRIPE_KEY__' };
}

function fill(text: string, keys: Record<string, string>): string {
	return text.replace(/__FAKE_[A-Z_]+__/g, (p) => keys[p] ?? p);
}

if (args.includes('--list')) {
	printGuide();
} else {
	process.exitCode = await runChecks();
}

function printGuide() {
	const out: string[] = [
		'# Try these',
		'',
		'Things each Macrohard persona might do in Claude Code, and what Safe Context should do.',
		'Open the persona\'s folder in Claude Code (terminal or desktop app) and type the prompt, or',
		'ask Claude to do what the "Claude reads" rows describe.',
		'',
		'Rows marked ⚠️ show where Safe Context falls short today. They are worth trying too.',
		'',
		'Generated from `demo/scenarios.ts` in the Safe Context repo.',
		''
	];
	for (const persona of ['dev', 'pm', 'sales'] as const) {
		out.push(`## ${PERSONA_TITLES[persona]}`, '', '| What you do | Expected | Why |', '| --- | --- | --- |');
		for (const s of SCENARIOS.filter((x) => x.persona === persona)) {
			const what =
				s.kind === 'prompt'
					? `Type: “${s.text.replace('__FAKE_STRIPE_KEY__', '<the STRIPE_SECRET_KEY from dev/.env>')}”`
					: s.kind === 'read'
						? `Claude reads \`${s.file}\``
						: `Claude runs \`${s.command.replace('__FAKE_STRIPE_KEY__', '<key>')}\``;
			const expected = { allow: '✅ goes through', block: '⛔ blocked', clean: '🧹 cleaned', unchanged: '✅ unchanged' }[
				s.expect
			];
			const why = s.gap ? `${s.why}<br>⚠️ **Known gap:** ${s.gap}` : s.why;
			out.push(`| ${what.replaceAll('|', '\\|')} | ${expected} | ${why.replaceAll('|', '\\|')} |`);
		}
		out.push('');
	}
	console.log(out.join('\n'));
}

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
	const res = await fetch(`http://127.0.0.1:${port}${path}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(30_000)
	});
	if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
	return (await res.json()) as Record<string, unknown>;
}

async function run(s: Scenario, keys: Record<string, string>): Promise<{ got: string; detail?: string }> {
	const common = { session_id: `demo-${s.persona}`, cwd: join(dir, s.persona), transcript_path: '/dev/null' };
	const toolUseId = `toolu_demo_${Math.random().toString(36).slice(2, 12)}`;
	if (s.kind === 'prompt') {
		const out = await post('/v1/prompt', { ...common, hook_event_name: 'UserPromptSubmit', prompt: fill(s.text, keys) });
		const reason = out['reason'] as string | undefined;
		if (unchecked(reason)) return { got: 'check failed', detail: reason };
		return { got: out['decision'] === 'block' ? 'block' : 'allow', detail: reason };
	}
	if (s.kind === 'bash') {
		const out = await post('/v1/tool-input', {
			...common,
			hook_event_name: 'PreToolUse',
			tool_name: 'Bash',
			tool_input: { command: fill(s.command, keys) },
			tool_use_id: toolUseId
		});
		const hso = out['hookSpecificOutput'] as { permissionDecision?: string; permissionDecisionReason?: string } | undefined;
		const reason = hso?.permissionDecisionReason;
		if (unchecked(reason)) return { got: 'check failed', detail: reason };
		return { got: hso?.permissionDecision === 'deny' ? 'block' : 'allow', detail: reason };
	}
	const filePath = join(dir, s.persona, s.file);
	const content = readFileSync(filePath, 'utf8');
	const out = await post('/v1/tool-output', {
		...common,
		hook_event_name: 'PostToolUse',
		tool_name: 'Read',
		tool_input: { file_path: filePath },
		tool_use_id: toolUseId,
		tool_response: {
			type: 'text',
			file: { filePath, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length }
		}
	});
	const hso = out['hookSpecificOutput'] as { updatedToolOutput?: { file?: { content?: string } } } | undefined;
	const cleaned = hso?.updatedToolOutput?.file?.content;
	if (cleaned === undefined) return { got: 'unchanged' };
	if (unchecked(cleaned)) return { got: 'check failed', detail: cleaned };
	const leaked = (s.hides ?? []).filter((h) => cleaned.includes(h));
	return { got: leaked.length ? `clean, but leaked ${leaked.join(', ')}` : 'clean', detail: cleaned };
}

async function runChecks(): Promise<number> {
	const keys = fakeKeys();
	let failed = 0;
	for (const s of SCENARIOS) {
		const label = s.kind === 'prompt' ? s.text : s.kind === 'read' ? `Read ${s.file}` : `Bash ${s.command}`;
		const started = performance.now();
		let result: { got: string; detail?: string };
		try {
			result = await run(s, keys);
		} catch (err) {
			result = { got: `error: ${(err as Error).message}` };
		}
		const ms = Math.round(performance.now() - started);
		const ok = result.got === s.expect;
		if (!ok) failed++;
		console.log(`${ok ? 'ok  ' : 'FAIL'} [${s.persona}] ${fill(label, {}).slice(0, 90)} → ${result.got} (${ms} ms)`);
		if (!ok || args.includes('--verbose')) {
			if (result.detail) console.log(`       ${result.detail.replaceAll('\n', '\n       ')}`);
		}
	}
	console.log(`\n${SCENARIOS.length - failed}/${SCENARIOS.length} as expected`);
	return failed ? 1 : 0;
}
