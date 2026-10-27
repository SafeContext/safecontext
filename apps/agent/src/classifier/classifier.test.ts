import type { Detector } from '@safecontext/detectors';
import { describe, expect, it, vi } from 'vitest';
import { fakeTier, policyWith, SECRET } from '../test-helpers.ts';
import { createClassifier } from './classifier.ts';
import { createTier0 } from './tier0.ts';
import type { ClassifierTier } from './types.ts';

const policy = policyWith();

describe('createClassifier', () => {
	it('runs tier 0 and returns spans per text, in order', async () => {
		const c = createClassifier({ tiers: [createTier0()], budgetMs: 1_000 });
		const result = await c.classify(['nothing here', `key ${SECRET}`, ''], policy);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.spans.map((s) => s.length)).toEqual([0, 1, 0]);
		expect(result.spans[1]![0]).toMatchObject({ dataTypeId: 'secrets', start: 4, end: 4 + SECRET.length });
		expect(result.tiers.map((t) => t.id)).toEqual(['tier0']);
	});

	it('merges spans from later tiers with earlier ones', async () => {
		const tier1 = fakeTier({
			id: 'tier1',
			spans: (texts) =>
				texts.map(() => [{ start: 0, end: 3, dataTypeId: 'customer-names', source: 'tagger', confidence: 0.8 }])
		});
		const c = createClassifier({ tiers: [createTier0(), tier1], budgetMs: 1_000 });
		const result = await c.classify([`Abc ${SECRET}`], policy);
		expect(result.ok && result.spans[0]!.map((s) => s.dataTypeId)).toEqual(['customer-names', 'secrets']);
	});

	it('skips a tier when shouldRun says no, and passes it the spans so far', async () => {
		const shouldRun = vi.fn(() => false);
		const tier1 = { ...fakeTier({ throws: true }), shouldRun };
		const c = createClassifier({ tiers: [createTier0(), tier1], budgetMs: 1_000 });
		const result = await c.classify([SECRET], policy);
		expect(result.ok).toBe(true);
		expect(shouldRun).toHaveBeenCalledWith(
			expect.objectContaining({ spans: [[expect.objectContaining({ dataTypeId: 'secrets' })]] })
		);
	});

	it('reports an error when a tier returns the wrong number of span arrays', async () => {
		const bad = fakeTier({ spans: () => [] });
		const result = await createClassifier({ tiers: [bad], budgetMs: 1_000 }).classify(['a', 'b'], policy);
		expect(result).toMatchObject({ ok: false, failure: 'error' });
	});

	it('reports a timeout when a sync tier overruns the budget', async () => {
		let clock = 0;
		const slow = {
			id: 'slow',
			tier: 0 as const,
			detect: (texts: readonly string[]) => ((clock += 100), texts.map(() => []))
		};
		const result = await createClassifier({ tiers: [slow], budgetMs: 50, now: () => clock }).classify(['a'], policy);
		expect(result).toMatchObject({ ok: false, failure: 'timeout' });
	});

	it('aborts the signal when the budget runs out', async () => {
		let signal: AbortSignal | undefined;
		const hang: ClassifierTier = {
			id: 'hang',
			tier: 2,
			detect: (_texts, ctx) => {
				signal = ctx.signal;
				return new Promise<never>(() => {});
			}
		};
		const result = await createClassifier({ tiers: [hang], budgetMs: 10 }).classify(['a'], policy);
		expect(result).toMatchObject({ ok: false, failure: 'timeout' });
		expect(signal?.aborted).toBe(true);
	});
});

describe('createTier0', () => {
	it('adds policy-built detectors (the term-list plug point) and builds them once per policy', async () => {
		const build = vi.fn((): Detector[] => [
			{
				id: 'terms',
				detect: (t) =>
					t.includes('Atlas')
						? [
								{
									start: t.indexOf('Atlas'),
									end: t.indexOf('Atlas') + 5,
									dataTypeId: 'unreleased-roadmap',
									source: 'list',
									confidence: 1
								}
							]
						: []
			}
		]);
		const tier0 = createTier0({ policyDetectors: build });
		const ctx = { policy, signal: new AbortController().signal, remainingMs: 1_000 };
		expect(await tier0.detect(['Project Atlas'], ctx)).toEqual([
			[expect.objectContaining({ dataTypeId: 'unreleased-roadmap' })]
		]);
		await tier0.detect(['again'], ctx);
		expect(build).toHaveBeenCalledTimes(1);
	});
});
