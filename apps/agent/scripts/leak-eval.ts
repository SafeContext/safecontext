// Issue #115: the product-level leak score. Starts the real agent (no dashboard sync), sends each
// document of a split to /v1/tool-output as if Claude had opened it with Read (the request the
// plugin makes), and scores what Claude would actually see:
//
//   caught   a sensitive item's exact text is no longer in what Claude sees
//   changed  a safe document (no gold spans) came back different
//   withheld the check couldn't finish, so Claude got the "couldn't check" notice instead
//
//   SC_TIER1_MODEL_DIR=$PWD/ml/models/tier1-onnx SC_TIER2_MODEL=gemma4:e4b-it-q4_K_M \
//     pnpm --filter @safecontext/agent exec tsx scripts/leak-eval.ts \
//     [--data ml/data/llm-test/llm-test.jsonl] [--source macrohard-offline] \
//     [--terms unreleased-roadmap=path/to/codenames.txt] [--name llm-test] [--out ml/results] [--json]
//
// Paths are relative to the repo root. Tiers 1 and 2 are on when their SC_TIER1_* / SC_TIER2_*
// settings are set, as for the agent itself. `--terms` adds a term list to the default policy
// (one term per line, or a JSON array), like a company's own list from the dashboard.
// The documents are made-up test data, so the report may quote missed items.
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { defaultPolicy, Policy } from '@safecontext/policy';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const agentDir = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const arg = (name: string): string | undefined => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
};
const all = (name: string): string[] =>
	args.flatMap((a, i) => (a === `--${name}` && args[i + 1] ? [args[i + 1]!] : []));

const dataPath = resolve(root, arg('data') ?? 'ml/data/llm-test/llm-test.jsonl');
const source = arg('source');
const name =
	arg('name') ??
	source ??
	dataPath
		.split('/')
		.pop()!
		.replace(/\.jsonl$/, '');
const outDir = resolve(root, arg('out') ?? 'ml/results');

interface GoldSpan {
	start: number;
	end: number;
	label: string;
	text: string;
}
interface Doc {
	id: string;
	text: string;
	spans: GoldSpan[];
	source: string;
	genre?: string;
}

const docs = readFileSync(dataPath, 'utf8')
	.split('\n')
	.filter((l) => l.trim())
	.map((l) => JSON.parse(l) as Doc)
	.filter((d) => !source || d.source === source);
if (!docs.length) throw new Error(`no documents in ${dataPath}${source ? ` from ${source}` : ''}`);

// The policy: the default, plus any term lists given.
const base = defaultPolicy();
const lists = all('terms').map((spec) => {
	const [dataTypeId, file] = spec.split('=') as [string, string | undefined];
	if (!file) throw new Error(`--terms wants dataTypeId=file, got ${spec}`);
	const raw = readFileSync(resolve(root, file), 'utf8').trim();
	const terms = raw.startsWith('[') ? (JSON.parse(raw) as string[]) : raw.split('\n').map((t) => t.trim());
	return { dataTypeId, terms: terms.filter(Boolean) };
});
const policy = Policy.parse({ ...base, version: 1, lists: [...base.lists, ...lists] });
const tmp = mkdtempSync(join(os.tmpdir(), 'sc-leak-eval-'));
const policyFile = join(tmp, 'policy.json');
writeFileSync(policyFile, JSON.stringify(policy));

const agent = await startAgent(policyFile);
const pct = (xs: number[], p: number) =>
	[...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil((p / 100) * xs.length) - 1)] ?? 0;

interface Result {
	id: string;
	safe: boolean;
	changed: boolean;
	withheld: boolean;
	ms: number;
	spans: Array<{ label: string; text: string; leaked: boolean }>;
}
const results: Result[] = [];
try {
	for (const [i, doc] of docs.entries()) {
		const filePath = `/eval/${doc.id}.md`;
		const lines = doc.text.split('\n').length;
		const t0 = performance.now();
		const res = await fetch(`http://127.0.0.1:${agent.port}/v1/tool-output`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				session_id: `leak-eval-${doc.id}`,
				transcript_path: '/dev/null',
				cwd: '/eval',
				hook_event_name: 'PostToolUse',
				tool_name: 'Read',
				tool_input: { file_path: filePath },
				tool_use_id: `toolu_eval_${i}`,
				tool_response: {
					type: 'text',
					file: { filePath, content: doc.text, numLines: lines, startLine: 1, totalLines: lines }
				}
			}),
			signal: AbortSignal.timeout(120_000)
		});
		const ms = performance.now() - t0;
		if (!res.ok) throw new Error(`${doc.id}: HTTP ${res.status}`);
		const body = (await res.json()) as { hookSpecificOutput?: { updatedToolOutput?: { file?: { content?: string } } } };
		const replaced = body.hookSpecificOutput?.updatedToolOutput?.file?.content;
		const seen = replaced ?? doc.text;
		// The agent's "couldn't check" notice (apps/agent/src/messages.ts).
		const withheld = replaced !== undefined && /couldn't (?:be )?check/.test(replaced);
		results.push({
			id: doc.id,
			safe: doc.spans.length === 0,
			changed: replaced !== undefined,
			withheld,
			ms,
			spans: doc.spans.map((s) => ({ label: s.label, text: s.text, leaked: seen.includes(s.text) }))
		});
		process.stderr.write(`\r${i + 1}/${docs.length}`);
	}
	process.stderr.write('\n');
} finally {
	await agent.stop();
	rmSync(tmp, { recursive: true, force: true });
}

// Scores.
const items = results.flatMap((r) => r.spans);
const caught = items.filter((s) => !s.leaked).length;
// Withholding a whole document hides every item in it, so also score detection on its own.
const checkedItems = results.filter((r) => !r.withheld).flatMap((r) => r.spans);
const detected = checkedItems.filter((s) => !s.leaked).length;
const safe = results.filter((r) => r.safe);
const byLabel = new Map<string, { n: number; caught: number; missed: string[] }>();
for (const s of items) {
	const row = byLabel.get(s.label) ?? { n: 0, caught: 0, missed: [] };
	row.n++;
	if (s.leaked) row.missed.push(s.text);
	else row.caught++;
	byLabel.set(s.label, row);
}
const ms = results.map((r) => r.ms);
const percent = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '–');
const commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
const chip = (() => {
	try {
		return execSync('sysctl -n machdep.cpu.brand_string').toString().trim();
	} catch {
		return os.cpus()[0]?.model ?? 'unknown';
	}
})();
const tier1 = process.env.SC_TIER1_MODEL_DIR ? modelRevision(process.env.SC_TIER1_MODEL_DIR) : 'off';
const tier2 =
	process.env.SC_TIER2_MODEL || process.env.SC_TIER2_BASE_URL ? (process.env.SC_TIER2_MODEL ?? 'default') : 'off';

const summary = {
	name,
	data: dataPath.replace(root, ''),
	source: source ?? null,
	commit,
	chip,
	tier1,
	tier2,
	termLists: lists.map((l) => ({ dataTypeId: l.dataTypeId, terms: l.terms.length })),
	documents: results.length,
	items: items.length,
	caught,
	checkedItems: checkedItems.length,
	detected,
	safeDocuments: safe.length,
	safeChanged: safe.filter((r) => r.changed && !r.withheld).length,
	withheld: results.filter((r) => r.withheld).length,
	msP50: Math.round(pct(ms, 50)),
	msP95: Math.round(pct(ms, 95)),
	byLabel: Object.fromEntries([...byLabel].map(([k, v]) => [k, { items: v.n, caught: v.caught }]))
};

const md = [
	`# Leak score through the agent: \`${name}\``,
	'',
	`Generated by \`apps/agent/scripts/leak-eval.ts\` (issue #115). Each document goes to the agent's`,
	'`/v1/tool-output` as a `Read` result; an item counts as caught when its exact text is no longer in',
	'what Claude would see.',
	'',
	`- **Data:** \`${summary.data}\`${source ? `, source \`${source}\`` : ''}: ${results.length} documents, ${items.length} sensitive items, ${safe.length} safe documents`,
	`- **Agent:** commit \`${commit}\`, tier 1 ${tier1}, tier 2 ${tier2}, default policy${lists.length ? ` + term lists (${lists.map((l) => `${l.dataTypeId}: ${l.terms.length} terms`).join(', ')})` : ''}`,
	`- **Machine:** ${chip}`,
	'',
	'| | |',
	'| --- | ---: |',
	`| **Items caught** | **${caught}/${items.length} (${percent(caught, items.length)})** |`,
	`| Items caught in documents that weren't withheld | ${detected}/${checkedItems.length} (${percent(detected, checkedItems.length)}) |`,
	`| Safe documents changed | ${summary.safeChanged}/${safe.length} |`,
	`| Documents withheld (check couldn't finish) | ${summary.withheld}/${results.length} |`,
	`| Check time p50 / p95 | ${summary.msP50} / ${summary.msP95} ms |`,
	'',
	'| Label | Caught | Missed (up to 8) |',
	'| --- | ---: | --- |',
	...[...byLabel]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(
			([label, v]) =>
				`| ${label} | ${v.caught}/${v.n} (${percent(v.caught, v.n)}) | ${[...new Set(v.missed)]
					.slice(0, 8)
					.map((t) => `\`${t.replaceAll('|', '\\|').replaceAll('`', "'")}\``)
					.join(', ')} |`
		),
	''
].join('\n');

const file = join(outDir, `leak-${name}.md`);
writeFileSync(file, md);
if (args.includes('--json')) console.log(JSON.stringify(summary, null, 2));
else console.log(md);
console.error(`wrote ${file.replace(root, '')}`);

/** The tier 1 model's pinned revision (provenance.json), else the folder name. */
function modelRevision(dir: string): string {
	try {
		const p = JSON.parse(readFileSync(join(dir, 'provenance.json'), 'utf8')) as Record<string, unknown>;
		const rev = (p['revision'] ?? p['commit'] ?? p['hf_revision']) as string | undefined;
		return `\`${dir.split('/').filter(Boolean).pop()}\`${rev ? ` @ ${String(rev).slice(0, 8)}` : ''}`;
	} catch {
		return `\`${dir.split('/').filter(Boolean).pop()}\``;
	}
}

/** The real agent on a free port, without dashboard sync, waiting for the model tiers it was given. */
function startAgent(policyFile: string): Promise<{ port: number; stop: () => Promise<void> }> {
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith('SC_') || /^SC_TIER[12]_/.test(k))
	) as NodeJS.ProcessEnv;
	env.SC_AGENT_PORT = '0';
	// Its own state folder and keys in memory only: each run starts clean. With the default folder
	// it would reload the keys an earlier run saved (#85) and re-hide what other tiers found then.
	env.SC_STATE_DIR = join(tmp, 'state');
	env.SC_SAVE_KEYS = 'off';
	env.SC_POLICY_FILE = policyFile;
	const wantTier1 = Boolean(env.SC_TIER1_MODEL_DIR);
	const wantTier2 = Boolean(env.SC_TIER2_MODEL || env.SC_TIER2_BASE_URL);
	const child: ChildProcess = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
		cwd: agentDir,
		env,
		stdio: ['ignore', 'ignore', 'pipe']
	});
	const stop = () =>
		new Promise<void>((done) => {
			if (child.exitCode !== null || child.signalCode !== null) return done();
			child.once('exit', () => done());
			child.kill('SIGTERM');
		});
	return new Promise((ok, fail) => {
		let port: number | undefined;
		let t1 = !wantTier1;
		let t2 = !wantTier2;
		const timer = setTimeout(() => (child.kill(), fail(new Error('agent did not start in 120 s'))), 120_000);
		child.once('exit', (code) => fail(new Error(`agent exited with ${code}`)));
		createInterface({ input: child.stderr! }).on('line', (line) => {
			let e: { msg?: string; port?: number; reason?: string };
			try {
				e = JSON.parse(line);
			} catch {
				return;
			}
			if (e.msg === 'listening') port = e.port;
			if (e.msg === 'tier1_ready') t1 = true;
			if (e.msg === 'tier2_ready') t2 = true;
			if (e.msg === 'tier1_failed') fail(new Error('tier 1 failed to load'));
			if (e.msg === 'tier2_unavailable' && e.reason !== 'digest_mismatch') fail(new Error(`tier 2: ${e.reason}`));
			if (port && t1 && t2) {
				clearTimeout(timer);
				child.removeAllListeners('exit');
				ok({ port, stop });
			}
		});
	});
}
