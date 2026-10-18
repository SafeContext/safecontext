import { describe, expect, it } from 'vitest';
import { DEFAULT_DATA_TYPES, defaultPolicy } from './defaults.ts';
import { DataType, isNewerPolicy, Policy } from './policy.ts';

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

	it('has every tier represented and valid data types', () => {
		const tiers = new Set(DEFAULT_DATA_TYPES.map((d) => DataType.parse(d).tier));
		expect([...tiers].sort()).toEqual(['green', 'red', 'yellow']);
	});
});
