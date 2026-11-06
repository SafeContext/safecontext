import type { Span } from '@safecontext/detectors';
import { describe, expect, it } from 'vitest';
import type { Hit } from '../decide.ts';
import { mask } from './mask.ts';
import {
	createPlaceholderStore,
	dropPlaceholderSpans,
	formatPlaceholder,
	placeholderRanges,
	prefixFor
} from './placeholders.ts';
import { createRewriter } from './rewrite.ts';

const span = (start: number, end: number, dataTypeId: string): Span => ({
	start,
	end,
	dataTypeId,
	source: 'rule',
	confidence: 1
});
const hit = (dataTypeId: string, action: Hit['action'], name = dataTypeId): Hit => ({
	dataTypeId,
	name,
	tier: 'yellow',
	action,
	count: 1
});

describe('mask', () => {
	it('keeps the last 4 characters of a long value', () => {
		expect(mask('4242 4242 4242 4242')).toBe('****4242');
		expect(mask('jane@northwind.example')).toBe('****mple');
	});

	it('hides short values entirely', () => {
		expect(mask('10.0.0.12')).toBe('****');
		expect(mask('12345678901')).toBe('****');
	});

	it('never splits a character', () => {
		expect(mask('名前名前名前名前@例え.jp😀')).toBe('****.jp😀');
	});
});

describe('placeholder key', () => {
	it('names placeholders after the data type', () => {
		expect(prefixFor('customer-names')).toBe('customer_name');
		expect(prefixFor('customer-personal-data')).toBe('customer_personal_data');
		expect(prefixFor('secrets')).toBe('secret');
		expect(prefixFor('access')).toBe('access');
		expect(prefixFor('project-status')).toBe('project_status');
	});

	it('is consistent within a session, ignoring case and surrounding space', () => {
		const s = createPlaceholderStore().session('a');
		expect(s.idFor('customer-names', 'Northwind')).toBe('customer_name_1');
		expect(s.idFor('customer-names', 'Fabrikam')).toBe('customer_name_2');
		expect(s.idFor('customer-names', ' NORTHWIND ')).toBe('customer_name_1');
	});

	it('numbers each prefix separately, and the same text in another type separately', () => {
		const s = createPlaceholderStore().session('a');
		expect(s.idFor('customer-names', 'x')).toBe('customer_name_1');
		expect(s.idFor('secrets', 'x')).toBe('secret_1');
		// Two ids with the same prefix share one counter, so placeholders never clash.
		expect(s.idFor('customer-name', 'y')).toBe('customer_name_2');
	});

	it('keeps sessions apart', () => {
		const store = createPlaceholderStore();
		store.session('a').idFor('customer-names', 'Northwind');
		expect(store.session('b').idFor('customer-names', 'Fabrikam')).toBe('customer_name_1');
	});

	it('forgets a session after the idle time', () => {
		let t = 0;
		const store = createPlaceholderStore({ idleMs: 1_000, now: () => t });
		store.session('a').idFor('customer-names', 'Northwind');
		store.session('a').idFor('customer-names', 'Fabrikam');
		t = 999;
		expect(store.session('a').idFor('customer-names', 'Northwind')).toBe('customer_name_1');
		t = 2_000;
		expect(store.session('a').idFor('customer-names', 'Fabrikam')).toBe('customer_name_1');
	});

	it('drops idle sessions when another session is used', () => {
		let t = 0;
		const store = createPlaceholderStore({ idleMs: 1_000, now: () => t });
		store.session('a');
		store.session('b');
		t = 5_000;
		store.session('c');
		expect(store.size).toBe(1);
	});

	it('keeps at most maxSessions, dropping the least recently used', () => {
		const store = createPlaceholderStore({ maxSessions: 2 });
		store.session('a').idFor('t', 'x');
		store.session('b');
		store.session('a');
		store.session('c'); // drops b
		expect(store.size).toBe(2);
		expect(store.session('a').idFor('t', 'x')).toBe('t_1');
	});

	it('keeps at most maxPerSession values, never reusing a number', () => {
		const s = createPlaceholderStore({ maxPerSession: 2 }).session('a');
		expect(s.idFor('t', 'one')).toBe('t_1');
		expect(s.idFor('t', 'two')).toBe('t_2');
		expect(s.idFor('t', 'three')).toBe('t_3'); // drops "one"
		expect(s.idFor('t', 'two')).toBe('t_2');
		expect(s.idFor('t', 'one')).toBe('t_4');
		expect(s.valueOf('t_1')).toBeUndefined();
	});

	it('holds the real value behind each id, as first seen', () => {
		const s = createPlaceholderStore().session('a');
		s.idFor('customer-names', 'Northwind');
		s.idFor('customer-names', 'NORTHWIND');
		expect(s.valueOf('customer_name_1')).toBe('Northwind');
		expect(s.valueOf('customer_name_2')).toBeUndefined();
		expect(s.entries()).toEqual([
			{ id: 'customer_name_1', dataTypeId: 'customer-names', value: 'Northwind', spellings: ['Northwind', 'NORTHWIND'] }
		]);
		expect(s.spellingsOf('customer_name_1')).toEqual(['Northwind', 'NORTHWIND']);
		expect(s.spellingsOf('customer_name_2')).toEqual([]);
	});
});

describe('placeholder text', () => {
	it('labels the value, with an optional hint', () => {
		expect(formatPlaceholder('customer_name_1')).toBe('⟪customer_name_1⟫');
		expect(formatPlaceholder('revenue_figure_2', 'over $4M')).toBe('⟪revenue_figure_2: over $4M⟫');
		expect(formatPlaceholder('x_1', '  ')).toBe('⟪x_1⟫');
	});

	it('keeps a hint from ending the placeholder early', () => {
		expect(formatPlaceholder('x_1', 'a⟫b\nc')).toBe('⟪x_1: a b c⟫');
	});

	it('finds placeholders, with or without a hint, and nothing else', () => {
		const text = 'a ⟪customer_name_1⟫ b ⟪revenue_figure_12: over $4M⟫ c ⟪not one⟫ ⟪x_0⟫ ⟪Upper_1⟫';
		expect(placeholderRanges(text).map((r) => [text.slice(r.start, r.end), r.id])).toEqual([
			['⟪customer_name_1⟫', 'customer_name_1'],
			['⟪revenue_figure_12: over $4M⟫', 'revenue_figure_12']
		]);
	});

	it('drops spans that overlap a placeholder', () => {
		const text = 'Northwind ⟪customer_name_1⟫';
		const spans = [span(0, 9, 'customer-names'), span(10, 20, 'customer-names')];
		expect(dropPlaceholderSpans(text, spans)).toEqual([spans[0]]);
	});
});

describe('rewriter', () => {
	const store = () => createPlaceholderStore().session('s');

	it('turns every hidden value into a labelled placeholder and keeps the text around the spans', async () => {
		const text = 'A Northwind B 4242 4242 4242 4242 C $4.2M D sk_x E ok F 1234';
		const at = (s: string, id: string) => span(text.indexOf(s), text.indexOf(s) + s.length, id);
		const rewrite = createRewriter(
			[
				hit('customer-names', 'pseudonymize'),
				hit('cards', 'mask'),
				hit('revenue-figures', 'generalize', 'Revenue figures'),
				hit('secrets', 'block', 'API keys & secrets'),
				hit('public-docs', 'allow')
			],
			store()
		);
		const spans = [
			at('$4.2M', 'revenue-figures'),
			at('Northwind', 'customer-names'),
			at('4242 4242 4242 4242', 'cards'),
			at('sk_x', 'secrets'),
			at('ok', 'public-docs'),
			at('1234', 'cards')
		];
		expect(await rewrite(text, spans)).toBe(
			'A ⟪customer_name_1⟫ B ⟪card_1: ****4242⟫ C ⟪revenue_figure_1: over $4M⟫ D ⟪secret_1⟫ E ok F ⟪card_2⟫'
		);
	});

	it('returns the text unchanged with no spans', async () => {
		expect(await createRewriter([], store())('hello', [])).toBe('hello');
	});

	it('hides a span whose data type it was not told about', async () => {
		expect(await createRewriter([], store())('a secret b', [span(2, 8, 'mystery')])).toBe('a ⟪mystery_1⟫ b');
	});

	it('clamps overlapping or out-of-range spans without exposing or repeating text', async () => {
		const rewrite = createRewriter([hit('x', 'block', 'X')], store());
		expect(await rewrite('abcdefgh', [span(1, 4, 'x'), span(3, 6, 'x'), span(7, 99, 'x')])).toBe('a⟪x_1⟫⟪x_2⟫g⟪x_3⟫');
	});
});
