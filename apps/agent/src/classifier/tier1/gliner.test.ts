/**
 * Runs only with a real model: `SC_TIER1_MODEL_DIR=<export dir> pnpm --filter @safecontext/agent test`.
 * Checks the agent's GLiNER code against the Python reference from the #5 spike
 * (ml/spikes/gliner/reference_spans.json, made with urchade/gliner_small-v2.1), and times it.
 * Without the env var it is skipped, so `pnpm test` never needs the model.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { policyWith } from '../../test-helpers.ts';
import { createClassifier } from '../classifier.ts';
import { createTier0, termListDetectors } from '../tier0.ts';
import { loadGliner, type TaggerModel } from './gliner.ts';
import { createTier1 } from './tier1.ts';

const dir = process.env.SC_TIER1_MODEL_DIR;
const spike = join(import.meta.dirname, '../../../../../ml/spikes/gliner');

interface RefSpan {
	start: number;
	end: number;
	label: string;
	score: number;
}

describe.skipIf(!dir)('GLiNER with the real model (SC_TIER1_MODEL_DIR)', () => {
	const samples = JSON.parse(readFileSync(join(spike, 'samples.json'), 'utf8')) as {
		labels: string[];
		texts: string[];
	};
	const ref = JSON.parse(readFileSync(join(spike, 'reference_spans.json'), 'utf8')) as {
		threshold: number;
		onnx_python: RefSpan[][];
	};
	// One data type per spike label, so the label texts match the reference exactly.
	const policy = policyWith({
		dataTypes: samples.labels.map((name, i) => ({
			id: `spike-${i}`,
			name,
			description: name,
			examples: [],
			tier: 'red' as const,
			action: 'block' as const
		}))
	});
	let model: TaggerModel;
	beforeAll(async () => {
		model = await loadGliner(dir!);
	}, 60_000);
	afterAll(() => model?.close());

	it('finds the same spans as Python gliner, with the same scores', async () => {
		const tier1 = createTier1({ model, threshold: ref.threshold });
		const signal = new AbortController().signal;
		const got = await tier1.detect(samples.texts, { policy, signal, remainingMs: 60_000 });
		const want = ref.onnx_python.map((spans) =>
			spans.map((s) => ({ start: s.start, end: s.end, dataTypeId: `spike-${samples.labels.indexOf(s.label)}` }))
		);
		expect(got.map((spans) => spans.map(({ start, end, dataTypeId }) => ({ start, end, dataTypeId })))).toEqual(want);
		got.flat().forEach((s, i) => expect(s.confidence).toBeCloseTo(ref.onnx_python.flat()[i]!.score, 4));
	}, 60_000);

	it('keeps tiers 0 + 1 under 300 ms at p95 for ~300-token texts (SPEC.md §5)', async () => {
		const classifier = createClassifier({
			tiers: [createTier0({ policyDetectors: termListDetectors }), createTier1({ model })],
			budgetMs: 10_000
		});
		const long = samples.texts.filter((t) => t.length > 1_000);
		for (const t of long.slice(0, 3)) await classifier.classify([t], policy); // warm-up
		const ms: number[] = [];
		for (let r = 0; r < 5; r++) {
			for (const t of long) {
				const result = await classifier.classify([t], policy, { hook: 'PostToolUse' });
				expect(result.ok).toBe(true);
				ms.push(result.ms);
			}
		}
		ms.sort((a, b) => a - b);
		const p95 = ms[Math.ceil(ms.length * 0.95) - 1]!;
		console.info(
			`tiers 0+1, ${long.length} texts of ~300 tokens: p50 ${ms[ms.length >> 1]!.toFixed(0)} ms, p95 ${p95.toFixed(0)} ms`
		);
		expect(p95).toBeLessThan(300);
	}, 60_000);
});
