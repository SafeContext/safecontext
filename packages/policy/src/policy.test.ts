import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA_TYPES, defaultPolicy } from './defaults.ts';
import { DataType, isNewerPolicy, LOCAL_SWAP_BACK_TOOLS, Policy, swapsBackInto } from './policy.ts';

const base = () => ({
	version: 1,
	updatedAt: '2026-10-17T12:00:00.000Z',
	dataTypes: [
		{ id: 'release-notes', name: 'Release notes', description: '', tier: 'green', action: 'allow' },
		{ id: 'customer-names', name: 'Customer names', description: '', tier: 'yellow', action: 'pseudonymize' }
	],
	lists: [{ dataTypeId: 'customer-names', terms: ['Northwind'] }]
});

describe('Policy', () => {
	it('accepts a valid policy and applies defaults', () => {
		const p = Policy.parse(base());
		expect(p.failMode).toBe('block');
		expect(p.dataTypes[0].examples).toEqual([]);
	});

	it('rejects duplicate data type ids', () => {
		const input = base();
		input.dataTypes[1].id = 'release-notes';
		expect(Policy.safeParse(input).success).toBe(false);
	});

	it('rejects a term list for an unknown data type', () => {
		const input = base();
		input.lists[0].dataTypeId = 'nope';
		expect(Policy.safeParse(input).success).toBe(false);
	});

	it('requires green <=> allow', () => {
		const greenBlock = base();
		greenBlock.dataTypes[0].action = 'block';
		expect(Policy.safeParse(greenBlock).success).toBe(false);

		const yellowAllow = base();
		yellowAllow.dataTypes[1].action = 'allow';
		expect(Policy.safeParse(yellowAllow).success).toBe(false);
	});

	it('rejects unknown fields and bad ids', () => {
		expect(Policy.safeParse({ ...base(), extra: true }).success).toBe(false);
		const badId = base();
		badId.dataTypes[0].id = 'Release Notes';
		expect(Policy.safeParse(badId).success).toBe(false);
	});

	it('only moves forward in version', () => {
		expect(isNewerPolicy(undefined, { version: 0 })).toBe(true);
		expect(isNewerPolicy({ version: 3 }, { version: 4 })).toBe(true);
		expect(isNewerPolicy({ version: 3 }, { version: 3 })).toBe(false);
	});
});

describe('defaults', () => {
	it('builds a valid default policy that blocks on failure', () => {
		const p = defaultPolicy(new Date('2026-10-17T00:00:00Z'));
		expect(p.version).toBe(0);
		expect(p.failMode).toBe('block');
		expect(p.dataTypes).toHaveLength(DEFAULT_DATA_TYPES.length);
	});

	it('has valid data types, all protected (no green defaults since #23)', () => {
		const tiers = new Set(DEFAULT_DATA_TYPES.map((d) => DataType.parse(d).tier));
		expect([...tiers].sort()).toEqual(['red', 'yellow']);
	});
});

describe('swapBack (issue #83)', () => {
	const minimal = { version: 1, updatedAt: '2026-11-06T00:00:00.000Z', dataTypes: defaultPolicy().dataTypes };

	it('defaults to the local file tools', () => {
		expect(Policy.parse(minimal).swapBack).toEqual({ tools: [...LOCAL_SWAP_BACK_TOOLS] });
		expect(Policy.parse({ ...minimal, swapBack: {} }).swapBack.tools).toEqual([...LOCAL_SWAP_BACK_TOOLS]);
	});

	it('takes tool names and prefixes ending in *', () => {
		const tools = ['Read', 'mcp__slack__*', 'mcp__github__create_issue', 'Bash'];
		expect(Policy.parse({ ...minimal, swapBack: { tools } }).swapBack.tools).toEqual(tools);
		expect(Policy.parse({ ...minimal, swapBack: { tools: [] } }).swapBack.tools).toEqual([]);
	});

	it.each(['Agent', 'Task', 'WebFetch', 'WebSearch', 'Web*', 'A*', '*'])(
		'rejects %s: its input would go to an Anthropic model',
		(pattern) => {
			const r = Policy.safeParse({ ...minimal, swapBack: { tools: ['Read', pattern] } });
			expect(r.success).toBe(false);
		}
	);

	it.each(['mcp__x__*a', 'two words', '', 'a'.repeat(129)])('rejects the malformed pattern %j', (pattern) => {
		expect(Policy.safeParse({ ...minimal, swapBack: { tools: [pattern] } }).success).toBe(false);
	});

	it('matches exact names and prefixes, and never the tools that reach a model', () => {
		expect(swapsBackInto(['mcp__slack__*'], 'mcp__slack__send_message')).toBe(true);
		expect(swapsBackInto(['mcp__slack__*'], 'mcp__github__x')).toBe(false);
		expect(swapsBackInto(['Read'], 'ReadMany')).toBe(false);
		expect(swapsBackInto(['Agent'], 'Agent')).toBe(false);
	});
});
