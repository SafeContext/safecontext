// The draft policy and publishing it (issue #23), against the database. Uses one throwaway
// organisation, deleted afterwards.
import { DEFAULT_DATA_TYPES, LOCAL_SWAP_BACK_TOOLS, Policy } from '@safecontext/policy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { latestPolicy } from '#lib/server/agent-api/policy.ts';
import {
	addDataType,
	deleteDataType,
	discardDraft,
	DraftError,
	draftStatus,
	loadDraft,
	moveDataType,
	publish,
	saveDataType,
	setFailMode,
	setSwapBackTools
} from '#lib/server/policy-draft.ts';
import { prisma } from '#lib/server/prisma.ts';

const slug = `test-policy-draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let orgId = '';
let memberId = '';

beforeAll(async () => {
	const org = await prisma.organization.create({ data: { slug, name: 'Policy draft test' } });
	orgId = org.id;
	memberId = (
		await prisma.member.create({ data: { organizationId: orgId, email: `${slug}@example.com` } })
	).id;
	const position: Record<string, number> = {};
	for (const dt of DEFAULT_DATA_TYPES) {
		await prisma.dataType.create({
			data: {
				organizationId: orgId,
				key: dt.id,
				name: dt.name,
				description: dt.description,
				examples: dt.examples,
				tier: dt.tier,
				action: dt.action,
				position: (position[dt.tier] = (position[dt.tier] ?? -1) + 1)
			}
		});
	}
});

afterAll(async () => {
	await prisma.organization.deleteMany({ where: { slug } });
});

const keysIn = async (tier: string) =>
	(await loadDraft(orgId)).dataTypes.filter((d) => d.tier === tier).map((d) => d.key);
const find = async (key: string) => (await loadDraft(orgId)).dataTypes.find((d) => d.key === key);

describe('policy draft', () => {
	it('loads the data types column by column, in order', async () => {
		const draft = await loadDraft(orgId);
		expect(draft.dataTypes.map((d) => d.key)).toEqual(DEFAULT_DATA_TYPES.map((d) => d.id));
		expect(draft.failMode).toBe('block');
		expect(draft.swapBackTools).toEqual([...LOCAL_SWAP_BACK_TOOLS]);
	});

	it('has unpublished changes before the first publish, and none right after', async () => {
		expect((await draftStatus(orgId, await loadDraft(orgId))).changed).toBe(true);
		expect(await publish(orgId, memberId)).toBe(1);
		const status = await draftStatus(orgId, await loadDraft(orgId));
		expect(status).toMatchObject({ changed: false, published: { version: 1 } });
		// Publishing again with no change is refused (no duplicate versions).
		await expect(publish(orgId, memberId)).rejects.toThrow('Nothing has changed');
	});

	it('moving a pill changes its column, action and place, and counts as a change', async () => {
		await moveDataType(orgId, 'deal-sizes', 'red', 'secrets');
		expect(await keysIn('red')).toEqual([
			'unreleased-roadmap',
			'deal-sizes',
			'secrets',
			'customer-personal-data'
		]);
		expect(await find('deal-sizes')).toMatchObject({ tier: 'red', action: 'block' });
		expect((await draftStatus(orgId, await loadDraft(orgId))).changed).toBe(true);

		await moveDataType(orgId, 'deal-sizes', 'yellow', null);
		expect(await keysIn('yellow')).toEqual([
			'revenue-figures',
			'internal-metrics',
			'customer-names',
			'deal-sizes'
		]);
		// "Make it vague" doesn't offer block, so it gets the column default.
		expect(await find('deal-sizes')).toMatchObject({ tier: 'yellow', action: 'pseudonymize' });
		const deal = DEFAULT_DATA_TYPES.find((d) => d.id === 'deal-sizes')!;
		await saveDataType(orgId, 'deal-sizes', {
			tier: 'yellow',
			name: deal.name,
			description: deal.description,
			action: deal.action,
			terms: ''
		});
		// Back as published: order within a column alone isn't a change.
		expect((await draftStatus(orgId, await loadDraft(orgId))).changed).toBe(false);
	});

	it('adds a data type at the end of its column, with the column default and its word list', async () => {
		const key = await addDataType(orgId, 'red', {
			name: ' Medical  records ',
			description: 'Patient health information.',
			terms: 'Oakwood Clinic\n\noakwood clinic\nSt Mary’s'
		});
		expect(key).toBe('medical-records');
		expect((await keysIn('red')).at(-1)).toBe('medical-records');
		expect(await find(key)).toMatchObject({
			name: 'Medical records',
			tier: 'red',
			action: 'block',
			terms: ['Oakwood Clinic', 'St Mary’s']
		});
	});

	it('refuses a name another data type has (ignoring case), and over-long input', async () => {
		const add = (name: string) =>
			addDataType(orgId, 'yellow', { name, description: '', terms: '' });
		await expect(add('customer NAMES')).rejects.toThrow(DraftError);
		await expect(add('   ')).rejects.toThrow('Give the data type a name.');
		await expect(add('x'.repeat(81))).rejects.toThrow(DraftError);
		await expect(
			addDataType(orgId, 'yellow', { name: 'Long words', description: '', terms: 'y'.repeat(201) })
		).rejects.toThrow(DraftError);
	});

	it('saves name, description, action and words, and can change the column', async () => {
		await saveDataType(orgId, 'medical-records', {
			tier: 'red',
			name: 'Health records',
			description: 'Changed.',
			action: 'mask',
			terms: ''
		});
		expect(await find('medical-records')).toMatchObject({
			name: 'Health records',
			action: 'mask',
			terms: []
		});
		// The key stays, so past events still count against it.
		await saveDataType(orgId, 'medical-records', {
			tier: 'yellow',
			name: 'Health records',
			description: 'Changed.',
			action: 'generalize',
			terms: 'Oakwood Clinic'
		});
		expect(await find('medical-records')).toMatchObject({
			tier: 'yellow',
			action: 'generalize',
			terms: ['Oakwood Clinic']
		});
		await expect(
			saveDataType(orgId, 'medical-records', {
				tier: 'yellow',
				name: 'Health records',
				description: '',
				action: 'block',
				terms: ''
			})
		).rejects.toThrow("doesn't offer that option");
	});

	it('keeps a red pseudonymize when saved unchanged (the board shows it as block)', async () => {
		await saveDataType(orgId, 'customer-personal-data', {
			tier: 'red',
			name: 'Customer personal data',
			description: 'Edited.',
			action: 'block',
			terms: ''
		});
		expect((await find('customer-personal-data'))?.action).toBe('pseudonymize');
	});

	it("won't delete a built-in data type, but deletes others", async () => {
		await expect(deleteDataType(orgId, 'secrets')).rejects.toThrow("can't be deleted");
		await expect(deleteDataType(orgId, 'customer-personal-data')).rejects.toThrow(DraftError);
		await deleteDataType(orgId, 'medical-records');
		expect(await find('medical-records')).toBeUndefined();
		await expect(deleteDataType(orgId, 'medical-records')).rejects.toThrow('no longer exists');
	});

	it('checks swap-back tools with the contract, and sets the fail mode', async () => {
		await expect(setSwapBackTools(orgId, ['Read', 'WebFetch'])).rejects.toThrow('WebFetch');
		await expect(setSwapBackTools(orgId, ['mcp__*'])).resolves.toBeUndefined();
		await expect(setSwapBackTools(orgId, ['not a tool'])).rejects.toThrow('Use a tool name');
		await setSwapBackTools(orgId, ['Read', ' mcp__slack__* ', 'Read', '']);
		expect((await loadDraft(orgId)).swapBackTools).toEqual(['Read', 'mcp__slack__*']);
		await expect(setFailMode(orgId, 'maybe')).rejects.toThrow(DraftError);
		await setFailMode(orgId, 'allow');
		expect((await loadDraft(orgId)).failMode).toBe('allow');
	});

	it('publishes the draft as the next version, which the agent API serves', async () => {
		await addDataType(orgId, 'red', { name: 'Payroll', description: '', terms: 'Q4 bonus pool' });
		expect(await publish(orgId, memberId)).toBe(2);
		const served = await latestPolicy(orgId);
		expect(Policy.safeParse(served).success).toBe(true);
		expect(served).toMatchObject({
			version: 2,
			failMode: 'allow',
			swapBack: { tools: ['Read', 'mcp__slack__*'] }
		});
		expect(served?.dataTypes.find((d) => d.id === 'payroll')).toMatchObject({
			tier: 'red',
			action: 'block'
		});
		expect(served?.lists).toContainEqual({ dataTypeId: 'payroll', terms: ['Q4 bonus pool'] });
		const row = await prisma.policyVersion.findFirstOrThrow({
			where: { organizationId: orgId, version: 2 }
		});
		expect(row.publishedById).toBe(memberId);
	});

	it('discarding puts the draft back to the published version', async () => {
		const published = await loadDraft(orgId);
		await moveDataType(orgId, 'secrets', 'yellow', null);
		await deleteDataType(orgId, 'payroll');
		await setSwapBackTools(orgId, ['Read']);
		await setFailMode(orgId, 'block');
		expect((await draftStatus(orgId, await loadDraft(orgId))).changed).toBe(true);

		await discardDraft(orgId);
		const restored = await loadDraft(orgId);
		expect(restored).toEqual(published);
		expect((await draftStatus(orgId, restored)).changed).toBe(false);
	});

	it('discarding to a version with green types (published before #23) leaves them out', async () => {
		const latest = (await latestPolicy(orgId))!;
		const withGreen = Policy.parse({
			...latest,
			version: latest.version + 1,
			dataTypes: [
				{ id: 'public-docs', name: 'Public docs', description: '', tier: 'green', action: 'allow' },
				...latest.dataTypes
			]
		});
		await prisma.policyVersion.create({
			data: {
				organizationId: orgId,
				version: withGreen.version,
				failMode: withGreen.failMode,
				snapshot: withGreen
			}
		});
		await discardDraft(orgId);
		const draft = await loadDraft(orgId);
		expect(draft.dataTypes.some((d) => d.tier === 'green')).toBe(false);
		// Publishing would drop the green type, so that is an unpublished change.
		expect((await draftStatus(orgId, draft)).changed).toBe(true);
	});
});
