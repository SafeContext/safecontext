// The policy board's rules (issue #23): which choices each column offers and how pills move.
import { Action, DataType, DEFAULT_DATA_TYPES, Tier } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import {
	actionFor,
	BOARD_TIERS,
	BUILTIN_KEYS,
	COLUMNS,
	csvFirstColumn,
	isBoardTier,
	keyFromName,
	parseTerms,
	shownAction
} from './policy-board.ts';

describe('columns', () => {
	it('every action a column offers is valid for its tier under the policy contract', () => {
		for (const column of COLUMNS) {
			for (const action of column.actions) {
				const parsed = DataType.safeParse({
					id: 'x',
					name: 'X',
					description: '',
					tier: column.tier,
					action
				});
				expect(parsed.success, `${column.tier}/${action}`).toBe(true);
			}
		}
	});

	it('has the protected tiers only, in order (no "Safe to share": nothing looks for it)', () => {
		expect(COLUMNS.map((c) => c.tier)).toEqual(BOARD_TIERS);
		expect(BOARD_TIERS).toEqual(Tier.options.filter((t) => t !== 'green'));
		expect(isBoardTier('green')).toBe(false);
		expect(isBoardTier('red')).toBe(true);
	});
});

describe('actionFor', () => {
	it('never gives a protected column "allow"', () => {
		for (const tier of BOARD_TIERS) {
			for (const action of Action.options) expect(actionFor(tier, action)).not.toBe('allow');
		}
	});

	it('keeps an action the new column offers, else uses the column default', () => {
		expect(actionFor('yellow', 'generalize')).toBe('generalize');
		expect(actionFor('yellow', 'mask')).toBe('mask');
		expect(actionFor('yellow', 'allow')).toBe('pseudonymize');
		expect(actionFor('yellow', 'block')).toBe('pseudonymize');
		expect(actionFor('red', 'mask')).toBe('mask');
		expect(actionFor('red', 'allow')).toBe('block');
		expect(actionFor('red', 'generalize')).toBe('block');
	});

	it('keeps a red pseudonymize (same effect as block), and shows it as block', () => {
		expect(actionFor('red', 'pseudonymize')).toBe('pseudonymize');
		expect(shownAction('red', 'pseudonymize')).toBe('block');
		expect(shownAction('yellow', 'pseudonymize')).toBe('pseudonymize');
	});

	it('every default data type sits in a column that shows its action', () => {
		for (const dt of DEFAULT_DATA_TYPES) {
			expect(isBoardTier(dt.tier), dt.id).toBe(true);
			const column = COLUMNS.find((c) => c.tier === dt.tier)!;
			expect(column.actions, dt.id).toContain(shownAction(dt.tier, dt.action));
		}
	});
});

describe('built-in data types', () => {
	it('are in the default policy', () => {
		const ids = DEFAULT_DATA_TYPES.map((dt) => dt.id);
		for (const key of BUILTIN_KEYS) expect(ids).toContain(key);
	});
});

describe('keyFromName', () => {
	it('makes a kebab-case policy id', () => {
		expect(keyFromName('Medical records')).toBe('medical-records');
		expect(keyFromName('  API keys & secrets!! ')).toBe('api-keys-and-secrets');
		expect(keyFromName('Café résumés')).toBe('cafe-resumes');
		expect(keyFromName('🙂')).toBe('data-type');
	});

	it('adds a number when the id is taken', () => {
		expect(keyFromName('Medical records', ['medical-records'])).toBe('medical-records-2');
		expect(keyFromName('Medical records', ['medical-records', 'medical-records-2'])).toBe(
			'medical-records-3'
		);
	});

	it('always gives an id the contract accepts', () => {
		const long = 'A very long name '.repeat(10);
		for (const name of [long, '---x---', 'Ünïcödé', '42']) {
			const id = keyFromName(name, [keyFromName(name)]);
			expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,63}$/);
		}
	});
});

describe('word lists', () => {
	it('one term per line, trimmed, without blanks or repeats (ignoring case)', () => {
		expect(parseTerms('Northwind\n  Acme, Inc. \r\n\nnorthwind\nContoso')).toEqual([
			'Northwind',
			'Acme, Inc.',
			'Contoso'
		]);
	});

	it('takes the first column of a CSV, with quotes', () => {
		const csv = 'Northwind,enterprise\n"Acme, Inc.",smb\n"Say ""hi""",x\nContoso\n\n';
		expect(csvFirstColumn(csv)).toBe('Northwind\nAcme, Inc.\nSay "hi"\nContoso');
	});
});
