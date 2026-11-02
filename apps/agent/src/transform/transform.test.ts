import type { Span } from '@safecontext/detectors';
import { describe, expect, it } from 'vitest';
import type { Hit } from '../decide.ts';
import { mask } from './mask.ts';
import { createPseudonymStore, prefixFor } from './pseudonyms.ts';
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

describe('pseudonyms', () => {
	it('names placeholders after the data type', () => {
		expect(prefixFor('customer-names')).toBe('customer_name');
		expect(prefixFor('customer-personal-data')).toBe('customer_personal_data');
		expect(prefixFor('secrets')).toBe('secret');
		expect(prefixFor('access')).toBe('access');
		expect(prefixFor('project-status')).toBe('project_status');
	});

	it('is consistent within a session, ignoring case and surrounding space', () => {
		const s = createPseudonymStore().session('a');
		expect(s.get('customer-names', 'Northwind')).toBe('customer_name_1');
		expect(s.get('customer-names', 'Fabrikam')).toBe('customer_name_2');
		expect(s.get('customer-names', ' NORTHWIND ')).toBe('customer_name_1');
	});

	it('numbers each prefix separately, and the same text in another type separately', () => {
		const s = createPseudonymStore().session('a');
		expect(s.get('customer-names', 'x')).toBe('customer_name_1');
		expect(s.get('secrets', 'x')).toBe('secret_1');
		// Two ids with the same prefix share one counter, so placeholders never clash.
		expect(s.get('customer-name', 'y')).toBe('customer_name_2');
	});

	it('keeps sessions apart', () => {
		const store = createPseudonymStore();
		store.session('a').get('customer-names', 'Northwind');
		expect(store.session('b').get('customer-names', 'Fabrikam')).toBe('customer_name_1');
	});

	it('forgets a session after the idle time', () => {
		let t = 0;
		const store = createPseudonymStore({ idleMs: 1_000, now: () => t });
		store.session('a').get('customer-names', 'Northwind');
		store.session('a').get('customer-names', 'Fabrikam');
		t = 999;
		expect(store.session('a').get('customer-names', 'Northwind')).toBe('customer_name_1');
		t = 2_000;
		expect(store.session('a').get('customer-names', 'Fabrikam')).toBe('customer_name_1');
	});

	it('drops idle sessions when another session is used', () => {
		let t = 0;
		const store = createPseudonymStore({ idleMs: 1_000, now: () => t });
		store.session('a');
		store.session('b');
		t = 5_000;
		store.session('c');
		expect(store.size).toBe(1);
	});

	it('keeps at most maxSessions, dropping the least recently used', () => {
		const store = createPseudonymStore({ maxSessions: 2 });
		store.session('a').get('t', 'x');
		store.session('b');
		store.session('a');
		store.session('c'); // drops b
		expect(store.size).toBe(2);
		expect(store.session('a').get('t', 'x')).toBe('t_1');
	});

	it('keeps at most maxPerSession values, never reusing a number', () => {
		const s = createPseudonymStore({ maxPerSession: 2 }).session('a');
		expect(s.get('t', 'one')).toBe('t_1');
		expect(s.get('t', 'two')).toBe('t_2');
		expect(s.get('t', 'three')).toBe('t_3'); // drops "one"
		expect(s.get('t', 'two')).toBe('t_2');
		expect(s.get('t', 'one')).toBe('t_4');
	});
});

describe('rewriter', () => {
	const store = () => createPseudonymStore().session('s');

	it('applies each action and keeps the text around the spans', () => {
		const text = 'A Northwind B 4242 4242 4242 4242 C $4.2M D sk_x E ok';
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
			at('ok', 'public-docs')
		];
		expect(rewrite(text, spans)).toBe(
			'A customer_name_1 B ****4242 C [Revenue figures] D [Safe Context removed: API keys & secrets] E ok'
		);
	});

	it('returns the text unchanged with no spans', () => {
		expect(createRewriter([], store())('hello', [])).toBe('hello');
	});

	it('removes a span whose data type it was not told about', () => {
		expect(createRewriter([], store())('a secret b', [span(2, 8, 'mystery')])).toBe(
			'a [Safe Context removed: mystery] b'
		);
	});

	it('clamps overlapping or out-of-range spans without exposing or repeating text', () => {
		const rewrite = createRewriter([hit('x', 'block', 'X')], store());
		expect(rewrite('abcdefgh', [span(1, 4, 'x'), span(3, 6, 'x'), span(7, 99, 'x')])).toBe(
			'a[Safe Context removed: X][Safe Context removed: X]g[Safe Context removed: X]'
		);
	});
});
