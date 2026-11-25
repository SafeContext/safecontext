/** Every copy of a value flagged in a call is hidden, not just the one a tier found (#144). */
import { AGENT_API } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { createTier0 } from '../classifier/tier0.ts';
import type { ClassifierTier } from '../classifier/types.ts';
import { policyWith, testApp, toolOutput } from '../test-helpers.ts';
import { sameValueFinder } from './known.ts';

const { toolOutput: postTool } = AGENT_API;

/** Like the tagger in the benchmark: flags only the first copy of each term it knows. */
function firstOnly(terms: Record<string, string>): ClassifierTier {
	return {
		id: 'tagger',
		tier: 1,
		detect: (texts) =>
			texts.map((text) =>
				Object.entries(terms).flatMap(([term, dataTypeId]) => {
					const i = text.indexOf(term);
					return i === -1
						? []
						: [{ start: i, end: i + term.length, dataTypeId, source: 'tagger' as const, confidence: 0.9 }];
				})
			)
	};
}

const stdout = async (terms: Record<string, string>, text: string, policy = policyWith()) => {
	const { post } = testApp({ tiers: [createTier0(), firstOnly(terms)], policy });
	const res = await post(postTool.path, toolOutput('Bash', { stdout: text, stderr: '' }));
	return (postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput as { stdout: string } | undefined)
		?.stdout;
};

describe('every copy of a flagged value (#144)', () => {
	it('hides later copies, in any case, with the same placeholder', async () => {
		const out = await stdout(
			{ Northwind: 'customer-names' },
			'Northwind renewal\nCall Northwind on Monday.\nFile: deals/northwind-renewal.md'
		);
		expect(out).toBe(
			'⟪customer_name_1⟫ renewal\nCall ⟪customer_name_1⟫ on Monday.\nFile: deals/⟪customer_name_1⟫-renewal.md'
		);
	});

	it('finds copies across the fields of one output', async () => {
		const { post } = testApp({ tiers: [createTier0(), firstOnly({ Lumen: 'unreleased-roadmap' })] });
		const res = await post(
			postTool.path,
			toolOutput('Bash', { stdout: 'Launch: Lumen', stderr: 'warning: Lumen beta flag' })
		);
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toMatchObject({
			stdout: 'Launch: ⟪unreleased_roadmap_1⟫',
			stderr: 'warning: ⟪unreleased_roadmap_1⟫ beta flag'
		});
	});

	it('leaves whole words only, generic values, short values and names IT always shares', async () => {
		expect(await stdout({ Atlas: 'unreleased-roadmap' }, 'Atlas ships.\nAtlassian is a vendor.')).toBe(
			'⟪unreleased_roadmap_1⟫ ships.\nAtlassian is a vendor.'
		);
		const generic = sameValueFinder(
			['in 2027, 12% and Q3'],
			[
				[
					{ start: 3, end: 7, dataTypeId: 'unreleased-roadmap', source: 'tagger', confidence: 0.9 },
					{ start: 9, end: 12, dataTypeId: 'revenue-figures', source: 'tagger', confidence: 0.9 },
					{ start: 17, end: 19, dataTypeId: 'unreleased-roadmap', source: 'tagger', confidence: 0.9 }
				]
			]
		);
		expect(generic('2027 and 12% and Q3 again')).toEqual([]);
		const shared = await stdout(
			{ Flow: 'unreleased-roadmap' },
			'Flow 2.0 plan.\nFlow is our product.',
			policyWith({ allow: ['Flow'] })
		);
		expect(shared).toBeUndefined(); // allowed everywhere, so nothing changes
	});
});
