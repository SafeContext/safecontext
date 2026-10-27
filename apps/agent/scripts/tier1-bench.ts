// Issue #15: tier 0 + tier 1 latency through the classifier, with the real model and the default policy.
//
//   SC_TIER1_MODEL_DIR=../../ml/models/gliner_small-v2.1-onnx \
//     pnpm --filter @safecontext/agent exec tsx scripts/tier1-bench.ts [--runs 20] [--threads N] [--label '{name}'] [--show]
//
// Inputs: the 20 made-up texts from the #5 spike (ml/spikes/gliner/samples.json), one check each,
// plus a 5 KB tool output (several windows). --show prints what tier 1 found in each sample.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { defaultPolicy } from '@safecontext/policy';
import { createClassifier } from '../src/classifier/classifier.ts';
import { createTier0, termListDetectors } from '../src/classifier/tier0.ts';
import { createTier1, labelTemplate } from '../src/classifier/tier1/tier1.ts';
import { loadGliner } from '../src/classifier/tier1/gliner.ts';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const arg = (name: string): string | undefined => {
	const i = process.argv.indexOf(`--${name}`);
	return i >= 0 ? process.argv[i + 1] : undefined;
};
const runs = Number(arg('runs') ?? 20);
const threads = Number(arg('threads') ?? 0);
const label = arg('label') ?? '{name}';
const dir = process.env.SC_TIER1_MODEL_DIR ?? `${root}ml/models/gliner_small-v2.1-onnx`;
const { texts } = JSON.parse(readFileSync(`${root}ml/spikes/gliner/samples.json`, 'utf8')) as { texts: string[] };

const chip = (() => {
	try {
		return execSync('sysctl -n machdep.cpu.brand_string').toString().trim();
	} catch {
		return os.cpus()[0]?.model ?? 'unknown';
	}
})();
console.log(
	`chip=${chip} cores=${os.cpus().length} node=${process.version} threads=${threads || 'default'} label=${label}`
);

const t0 = performance.now();
const model = await loadGliner(dir, { threads });
console.log(`model load: ${(performance.now() - t0).toFixed(0)} ms, labels.json: ${model.labels ? 'yes' : 'no'}`);

const policy = defaultPolicy();
const tier1 = createTier1({ model, label: labelTemplate(label) });
const classifier = createClassifier({
	tiers: [createTier0({ policyDetectors: termListDetectors }), tier1],
	budgetMs: 10_000
});

if (process.argv.includes('--show')) {
	for (const text of texts) {
		const spans = await tier1.detect([text], { policy, signal: new AbortController().signal, remainingMs: 10_000 });
		console.log(`\n${text.slice(0, 100)}…`);
		for (const s of spans[0]!)
			console.log(`  ${s.dataTypeId} ${s.confidence.toFixed(2)}: ${text.slice(s.start, s.end)}`);
	}
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.ceil((p / 100) * xs.length) - 1]!;
async function time(name: string, inputs: string[][], hook: 'PostToolUse' | 'UserPromptSubmit') {
	for (const input of inputs.slice(0, 3)) await classifier.classify(input, policy, { hook }); // warm-up
	const ms: number[] = [];
	const tier1Ran: number[] = [];
	for (let r = 0; r < runs; r++) {
		for (const input of inputs) {
			const result = await classifier.classify(input, policy, { hook });
			if (!result.ok) throw new Error(`${name}: ${result.failure}`);
			ms.push(result.ms);
			tier1Ran.push(result.tiers.some((t) => t.id === 'tier1') ? 1 : 0);
		}
	}
	const ran = tier1Ran.reduce((a, b) => a + b, 0);
	console.log(
		`${name}: n=${ms.length} p50=${pct(ms, 50).toFixed(1)} ms p95=${pct(ms, 95).toFixed(1)} ms max=${Math.max(...ms).toFixed(1)} ms (tier 1 ran ${ran}/${ms.length})`
	);
}

const long = texts.filter((t) => t.length > 1_000);
await time(
	'tool output, each sample (12 short + 8 of ~300 tokens)',
	texts.map((t) => [t]),
	'PostToolUse'
);
await time(
	'tool output, ~300-token samples only',
	long.map((t) => [t]),
	'PostToolUse'
);
await time(
	'prompt, each sample (skips tier 1 when tier 0 blocks)',
	texts.map((t) => [t]),
	'UserPromptSubmit'
);
const fiveKb = texts.join('\n').repeat(2).slice(0, 5_120);
await time('tool output, 5 KB (several windows)', [[fiveKb]], 'PostToolUse');
console.log(`rss=${(process.memoryUsage().rss / 1e6).toFixed(0)} MB`);
await tier1.close();
