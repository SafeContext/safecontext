/**
 * Tier 2 with the real model (Gemma 4 E4B on Ollama). Skipped unless `SC_TIER2_REAL=1`, so CI
 * (no Ollama) runs only the mocked tests:
 *
 *   OLLAMA_CONTEXT_LENGTH=8192 ollama serve &
 *   SC_TIER2_REAL=1 pnpm --filter @safecontext/agent test tier2.real
 *
 * `SC_TIER2_BASE_URL` / `SC_TIER2_MODEL` point it elsewhere. Tier 1 is stood in for by a fixed
 * tagger, so this tests tier 2 alone.
 */
import { describe, expect, it } from 'vitest';
import { readConfig } from '../../config.ts';
import { decide } from '../../decide.ts';
import { memoryLogger } from '../../log.ts';
import { policyWith } from '../../test-helpers.ts';
import { createGeneralize } from '../../transform/generalize.ts';
import { createPseudonymStore } from '../../transform/pseudonyms.ts';
import { createRewriter } from '../../transform/rewrite.ts';
import { summarize } from '../../decide.ts';
import { createClassifier } from '../classifier.ts';
import type { ClassifierTier } from '../types.ts';
import { tier2FromConfig } from './tier2.ts';

const real = process.env.SC_TIER2_REAL === '1';

describe.skipIf(!real)('tier 2 with the real model (SC_TIER2_REAL=1)', () => {
	const env = { SC_TIER2_MODEL: 'gemma4:e4b-it-q4_K_M', ...process.env };
	const logger = memoryLogger();
	const tier2 = real ? tier2FromConfig(readConfig(env).tier2, logger)! : undefined;
	const policy = policyWith();
	const tagger: ClassifierTier = {
		id: 'tagger',
		tier: 1,
		detect: (texts) =>
			texts.map((text) =>
				['Project Heron', 'March 3'].flatMap((term) => {
					const spans = [];
					for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + 1)) {
						spans.push({
							start: i,
							end: i + term.length,
							dataTypeId: 'unreleased-roadmap',
							source: 'tagger' as const,
							confidence: 0.9
						});
					}
					return spans;
				})
			)
	};

	it('is ready', { timeout: 120_000 }, async () => {
		await tier2!.ready;
		expect(logger.records.map((r) => r.msg)).toContain('tier2_ready');
	});

	it('lets the press release through and still blocks the roadmap', { timeout: 30_000 }, async () => {
		const classifier = createClassifier({ tiers: [tagger, tier2!.tier], budgetMs: 8_000 });
		const press =
			'Orbitly announces Project Heron, now generally available. Project Heron launched publicly on March 3 and is available on every plan.';
		const plan = 'Launch plan (internal only): Project Heron ships to beta customers on March 3. Do not share.';
		const p = await classifier.classify([press], policy, { hook: 'UserPromptSubmit' });
		const r = await classifier.classify([plan], policy, { hook: 'UserPromptSubmit' });
		expect(decide(p, policy).verdict).toBe('allow');
		expect(decide(r, policy).verdict).toBe('block');
	});

	it(
		'generalizes numbers with the rule and a codename and date with the model, without the values',
		{ timeout: 30_000 },
		async () => {
			// Roadmap set to "make it vague" for this test, so its values go to the model.
			const vague = policyWith({
				dataTypes: policy.dataTypes.map((d) =>
					d.id === 'unreleased-roadmap' ? { ...d, tier: 'yellow' as const, action: 'generalize' as const } : d
				)
			});
			const text = 'Q3 revenue was $4.2M, up 18%. Project Heron ships to beta on March 3. Internal only.';
			const spans = [
				['$4.2M', 'revenue-figures'],
				['18%', 'revenue-figures'],
				['Project Heron', 'unreleased-roadmap'],
				['March 3', 'unreleased-roadmap']
			].map(([s, dataTypeId]) => ({
				start: text.indexOf(s!),
				end: text.indexOf(s!) + s!.length,
				dataTypeId: dataTypeId!,
				source: 'tagger' as const,
				confidence: 0.9
			}));
			const generalize = createGeneralize({
				model: tier2!.generalizer,
				policy: vague,
				deadline: performance.now() + 8_000
			});
			const rewrite = createRewriter(summarize(spans, vague), createPseudonymStore().session('s'), generalize);
			const out = await rewrite(text, spans);
			expect(out.startsWith('Q3 revenue was over $4M, up high teens. ')).toBe(true);
			for (const v of ['4.2', '18', 'Heron', 'March', '[Revenue figures]', '[Unreleased roadmap]']) {
				expect(out).not.toContain(v);
			}
		}
	);
});
