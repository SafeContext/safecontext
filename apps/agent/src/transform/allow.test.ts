import type { Span } from '@safecontext/detectors';
import { describe, expect, it } from 'vitest';
import { policyWith } from '../test-helpers.ts';
import { allowedBy, dropAllowedModelSpans } from './allow.ts';

const span = (text: string, word: string, source: Span['source'], dataTypeId = 'customer-names'): Span => {
	const start = text.indexOf(word);
	return { start, end: start + word.length, dataTypeId, source, confidence: 0.9 };
};

describe('always share (#117)', () => {
	const allowed = allowedBy(policyWith({ allow: ['Flow', 'Stripe'] }));

	it('matches whole terms, ignoring case and surrounding punctuation', () => {
		for (const v of ['Flow', 'flow', 'STRIPE', ' "Stripe".', '(Flow)']) expect(allowed(v)).toBe(true);
		for (const v of ['Flow Canvas', 'Stripes', 'Northwind']) expect(allowed(v)).toBe(false);
	});

	it('drops model spans on the list, keeps rule and word-list spans', () => {
		const text = 'Flow roadmap: Stripe, Northwind and key sk_live_x';
		const spans = [
			span(text, 'Flow', 'tagger', 'unreleased-roadmap'),
			span(text, 'Stripe', 'llm'),
			span(text, 'Northwind', 'tagger'),
			span(text, 'Stripe', 'list'),
			span(text, 'Flow', 'rule', 'secrets')
		];
		expect(dropAllowedModelSpans(text, spans, allowed).map((s) => [text.slice(s.start, s.end), s.source])).toEqual([
			['Northwind', 'tagger'],
			['Stripe', 'list'],
			['Flow', 'rule']
		]);
	});

	it('allows nothing when the list is empty', () => {
		expect(allowedBy(policyWith({}))('Flow')).toBe(false);
	});
});

describe('always share through the agent (#117)', async () => {
	const { AGENT_API } = await import('@safecontext/policy');
	const { createTier0 } = await import('../classifier/tier0.ts');
	const { fakeTier, testApp, toolOutput } = await import('../test-helpers.ts');
	const flowTagger = fakeTier({
		spans: (texts) =>
			texts.map((t) => {
				const at = t.indexOf('Flow');
				return at < 0
					? []
					: [{ start: at, end: at + 4, dataTypeId: 'unreleased-roadmap', source: 'tagger' as const, confidence: 0.9 }];
			})
	});
	const read = async (allow: string[], stdout: string) => {
		const { post } = testApp({ tiers: [createTier0(), flowTagger], policy: policyWith({ allow }) });
		const res = await post(AGENT_API.toolOutput.path, toolOutput('Bash', { stdout, stderr: '' }));
		const out = AGENT_API.toolOutput.response.parse(res.json).hookSpecificOutput?.updatedToolOutput as
			{ stdout: string } | undefined;
		return out?.stdout ?? stdout;
	};

	it('leaves a listed name the model flagged alone', async () => {
		expect(await read([], '# Flow roadmap: 2027')).toContain('⟪unreleased_roadmap_1⟫');
		expect(await read(['Flow'], '# Flow roadmap: 2027')).toBe('# Flow roadmap: 2027');
	});

	it('still hides a secret next to it', async () => {
		const key = `ghp_${'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC1234'}`;
		const out = await read(['Flow'], `Flow token ${key}`);
		expect(out).toContain('Flow');
		expect(out).not.toContain(key);
	});
});
