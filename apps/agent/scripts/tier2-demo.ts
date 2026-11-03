// Issue #16: the real agent with tiers 0+1+2 on made-up inputs, before (tiers 0+1) and after
// (tiers 0+1+2), plus p50/p95 latency per check. Needs Ollama with the pinned model and the
// tier 1 export:
//
//   OLLAMA_CONTEXT_LENGTH=8192 ollama serve &
//   SC_TIER1_MODEL_DIR="$PWD/ml/models/tier1-onnx" SC_TIER2_MODEL=gemma4:e4b-it-q4_K_M \
//     pnpm --filter @safecontext/agent exec tsx scripts/tier2-demo.ts [--runs 10]
//
// Every input is invented (the Orbitly-style company and codenames are fake).
import { AGENT_API, defaultPolicy } from '@safecontext/policy';
import { createApp } from '../src/app.ts';
import { createClassifier } from '../src/classifier/classifier.ts';
import { createTier0, termListDetectors } from '../src/classifier/tier0.ts';
import { tier1FromConfig } from '../src/classifier/tier1/tier1.ts';
import { tier2FromConfig } from '../src/classifier/tier2/tier2.ts';
import type { Classifier, ClassifyResult } from '../src/classifier/types.ts';
import { readConfig } from '../src/config.ts';
import { jsonLogger } from '../src/log.ts';
import { staticPolicySource } from '../src/policy-source.ts';

const arg = (name: string) => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const runs = Number(arg('runs') ?? 10);
const config = readConfig();
if (!config.tier1 || !config.tier2) throw new Error('set SC_TIER1_MODEL_DIR and SC_TIER2_MODEL (or SC_TIER2_BASE_URL)');

const logger = jsonLogger();
const tier1 = tier1FromConfig(config.tier1, logger)!;
const tier2 = tier2FromConfig(config.tier2, logger)!;
await tier2.ready;
const policy = staticPolicySource(defaultPolicy(new Date('2026-01-01T00:00:00Z')));

/** The agent's app with or without tier 2, recording each classify result. */
function agent(withTier2: boolean) {
	const results: ClassifyResult[] = [];
	const inner = createClassifier({
		tiers: [createTier0({ policyDetectors: termListDetectors }), tier1, ...(withTier2 ? [tier2.tier] : [])],
		budgetMs: config.checkBudgetMs
	});
	const classifier: Classifier = {
		classify: async (...a) => {
			const r = await inner.classify(...a);
			results.push(r);
			return r;
		}
	};
	const app = createApp({
		policy,
		classifier,
		generalizer: withTier2 ? tier2.generalizer : undefined,
		checkBudgetMs: config.checkBudgetMs
	});
	const post = async (path: string, body: unknown) => {
		const t = performance.now();
		const res = await app.request(path, { method: 'POST', body: JSON.stringify(body) });
		return { json: (await res.json()) as Record<string, unknown>, ms: performance.now() - t, result: results.at(-1) };
	};
	return { post };
}

const promptBody = (prompt: string) => ({ session_id: 's', cwd: '/w', hook_event_name: 'UserPromptSubmit', prompt });
const bashOutput = (stdout: string) => ({
	session_id: 's',
	cwd: '/w',
	hook_event_name: 'PostToolUse',
	tool_name: 'Bash',
	tool_input: { command: 'cat notes.txt' },
	tool_use_id: 't1',
	tool_response: { stdout, stderr: '', interrupted: false, isImage: false }
});

const PRESS =
	'Draft a tweet from this press release: "Orbitly announces Project Heron, now generally available. ' +
	'Project Heron launched publicly on March 3 and is available on every plan."';
const ROADMAP =
	'Summarise this for the team: "Launch plan (internal only): Project Heron, our new sync engine, ' +
	'ships to beta customers on March 3. Do not share outside the company."';
const REVENUE = 'Q3 revenue was $4.2M, up 18%';
const VAGUE = 'Revenue grew mid-teens and bookings were strong in EMEA.';
const TOOL_LONG =
	'Weekly business review (internal)\n\nQ3 revenue was $4.2M, up 18% on Q2. Gross margin hit 71%.\n' +
	'Bluefin Logistics renewed at $865k a year. Weekly active seats reached 23,418 and churn fell to 0.8%.\n' +
	'Next: hire two engineers for the data platform team.';

const show = (label: string, r: Awaited<ReturnType<ReturnType<typeof agent>['post']>>) => {
	const tiers = r.result?.tiers.map((t) => `${t.id} ${Math.round(t.ms)} ms`).join(', ');
	const cleared = r.result?.ok ? (r.result.cleared ?? 0) : 0;
	console.log(`\n${label}  (${Math.round(r.ms)} ms; ${tiers}; cleared ${cleared})`);
	console.log(JSON.stringify(r.json, null, 1));
};

const before = agent(false);
const after = agent(true);
// Warm both paths once so the numbers below aren't a cold start.
await after.post(AGENT_API.prompt.path, promptBody(ROADMAP));
await after.post(AGENT_API.toolOutput.path, bashOutput(TOOL_LONG));

console.log('=== Examples (before = tiers 0+1, after = tiers 0+1+2) ===');
for (const [label, path, body] of [
	['press-release prompt', AGENT_API.prompt.path, promptBody(PRESS)],
	['roadmap prompt', AGENT_API.prompt.path, promptBody(ROADMAP)],
	['tool output: revenue', AGENT_API.toolOutput.path, bashOutput(REVENUE)],
	['tool output: words, not a number', AGENT_API.toolOutput.path, bashOutput(VAGUE)],
	['tool output: business review', AGENT_API.toolOutput.path, bashOutput(TOOL_LONG)]
] as const) {
	show(`BEFORE ${label}`, await before.post(path, body));
	show(`AFTER  ${label}`, await after.post(path, body));
}

console.log(`\n=== Latency, tiers 0+1+2, ${runs} runs per input ===`);
const pct = (xs: number[], p: number) => {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};
const all: number[] = [];
for (const [label, path, body] of [
	['press-release prompt', AGENT_API.prompt.path, promptBody(PRESS)],
	['roadmap prompt', AGENT_API.prompt.path, promptBody(ROADMAP)],
	['clean prompt', AGENT_API.prompt.path, promptBody('Refactor the checkout handler to use async/await.')],
	['tool output: revenue', AGENT_API.toolOutput.path, bashOutput(REVENUE)],
	['tool output: business review', AGENT_API.toolOutput.path, bashOutput(TOOL_LONG)]
] as const) {
	const ms: number[] = [];
	for (let i = 0; i < runs; i++) ms.push((await after.post(path, body)).ms);
	all.push(...ms);
	console.log(`${label.padEnd(30)} p50 ${Math.round(pct(ms, 50))} ms  p95 ${Math.round(pct(ms, 95))} ms`);
}
console.log(`${'all'.padEnd(30)} p50 ${Math.round(pct(all, 50))} ms  p95 ${Math.round(pct(all, 95))} ms`);
await tier1.close();
