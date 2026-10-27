import { BUILTIN_DATA_TYPE, type TermList } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { createTermListDetector, defaultDetectors, detectAll } from './index.ts';

const CODENAMES = 'project-codenames';
const CUSTOMERS = 'customer-names';

const LISTS: TermList[] = [
	{ dataTypeId: CODENAMES, terms: ['Falcon', 'Project Bluebird', 'C++', '.NET'] },
	{ dataTypeId: CUSTOMERS, terms: ['Northwind', 'Northwind Traders', "Macy's", 'Müller', 'Straße'] }
];
const detector = createTermListDetector(LISTS);

/** The matched text of every span, in order. */
const found = (text: string, d = detector) => d.detect(text).map((s) => text.slice(s.start, s.end));

describe('createTermListDetector', () => {
	it('returns list spans with the list data type', () => {
		const text = 'Falcon ships for Northwind next week';
		expect(detector.detect(text)).toEqual([
			{ start: 0, end: 6, dataTypeId: CODENAMES, source: 'list', confidence: 1 },
			{ start: 17, end: 26, dataTypeId: CUSTOMERS, source: 'list', confidence: 1 }
		]);
	});

	it('ignores case', () => {
		expect(found('falcon FALCON fAlCoN')).toEqual(['falcon', 'FALCON', 'fAlCoN']);
	});

	it.each([
		['Falcon.', 'Falcon'],
		['(Falcon)', 'Falcon'],
		['"falcon",', 'falcon'],
		['falcon-api', 'falcon'],
		['pre-Falcon', 'Falcon'],
		['src/falcon/index.ts', 'falcon'],
		['#falcon', 'falcon'],
		['jane@northwind.com', 'northwind']
	])('matches a whole word next to punctuation: %s', (text, match) => {
		expect(found(text)).toEqual([match]);
	});

	it.each(['Falconry', 'unfalcon', 'Falcon2', '2Falcon', 'falcon_api', 'my_falcon', 'Falconé'])(
		'does not match inside a longer word: %s',
		(text) => {
			expect(found(text)).toEqual([]);
		}
	);

	it('does not match when a combining mark follows (a different word)', () => {
		expect(found('Falconé')).toEqual([]);
		expect(found('Falcoń')).toEqual([]);
	});

	it('handles possessives with straight and curly apostrophes', () => {
		expect(found("Northwind's renewal")).toEqual(['Northwind']);
		expect(found('Northwind’s renewal')).toEqual(['Northwind']);
		expect(found('NORTHWINDS')).toEqual([]);
	});

	it('matches terms that contain apostrophes, whatever apostrophe the text uses', () => {
		expect(found("Macy's, MACY’S and macyʼs")).toEqual(["Macy's", 'MACY’S', 'macyʼs']);
	});

	it('matches multi-word terms across any whitespace', () => {
		expect(found('Project Bluebird')).toEqual(['Project Bluebird']);
		expect(found('project  bluebird')).toEqual(['project  bluebird']);
		expect(found('Project\n\tBluebird')).toEqual(['Project\n\tBluebird']);
		expect(found('Project Bluebird')).toEqual(['Project Bluebird']);
		expect(found('ProjectBluebird')).toEqual([]);
	});

	it('normalizes whitespace in the terms too', () => {
		const d = createTermListDetector([{ dataTypeId: CODENAMES, terms: ['  Blue \n Heron  '] }]);
		expect(found('the blue heron launch', d)).toEqual(['blue heron']);
	});

	it('only needs a boundary on the word edges of a term', () => {
		expect(found('rewrite it in C++ today')).toEqual(['C++']);
		expect(found('C++17')).toEqual(['C++']);
		expect(found('ObjC++')).toEqual([]);
		expect(found('ASP.NET and .net core')).toEqual(['.NET', '.net']);
		expect(found('.NETWORK')).toEqual([]);
	});

	it('folds Unicode case', () => {
		expect(found('MÜLLER and müller')).toEqual(['MÜLLER', 'müller']);
		expect(found('STRASSE and straße')).toEqual(['STRASSE', 'straße']);
	});

	it('reports UTF-16 offsets after astral characters', () => {
		const text = '🙂🙂 Falcon 日本 Northwind 🙂';
		const spans = detector.detect(text);
		expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['Falcon', 'Northwind']);
		expect(spans[0]!.start).toBe(5);
	});

	it('treats emoji and CJK as non-word neighbours', () => {
		expect(found('🙂Falcon🙂')).toEqual(['Falcon']);
		expect(found('日本Falcon')).toEqual([]); // CJK letters are word characters
	});

	it('finds repeated and adjacent terms', () => {
		expect(found('Falcon Falcon,Falcon')).toEqual(['Falcon', 'Falcon', 'Falcon']);
	});

	describe('overlapping terms', () => {
		it('merges a term inside a longer one and keeps the longer data type', () => {
			expect(detector.detect('Northwind Traders')).toEqual([
				{ start: 0, end: 17, dataTypeId: CUSTOMERS, source: 'list', confidence: 1 }
			]);
		});

		it('prefers the longest match even when a shorter one comes from an earlier list', () => {
			const d = createTermListDetector([
				{ dataTypeId: CODENAMES, terms: ['Northwind'] },
				{ dataTypeId: CUSTOMERS, terms: ['Northwind Traders'] }
			]);
			expect(d.detect('Northwind Traders')).toEqual([
				{ start: 0, end: 17, dataTypeId: CUSTOMERS, source: 'list', confidence: 1 }
			]);
		});

		it('covers the union of partly overlapping matches', () => {
			const d = createTermListDetector([
				{ dataTypeId: CUSTOMERS, terms: ['Northwind Traders'] },
				{ dataTypeId: CODENAMES, terms: ['Traders Joe'] }
			]);
			expect(d.detect('Northwind Traders Joe')).toEqual([
				{ start: 0, end: 21, dataTypeId: CUSTOMERS, source: 'list', confidence: 1 }
			]);
		});

		it('uses the first list when the same term is in two lists', () => {
			const d = createTermListDetector([
				{ dataTypeId: CUSTOMERS, terms: ['Falcon'] },
				{ dataTypeId: CODENAMES, terms: ['falcon'] }
			]);
			expect(d.detect('Falcon')).toEqual([
				{ start: 0, end: 6, dataTypeId: CUSTOMERS, source: 'list', confidence: 1 }
			]);
		});

		it('finds a term whose prefix is another term (failure links)', () => {
			const d = createTermListDetector([{ dataTypeId: CODENAMES, terms: ['abcd', 'bc'] }]);
			expect(found('x abc y bc z', d)).toEqual(['bc']);
		});
	});

	it('returns nothing for empty lists, blank terms and clean text', () => {
		expect(createTermListDetector([]).detect('Falcon')).toEqual([]);
		expect(
			createTermListDetector([{ dataTypeId: CODENAMES, terms: [' ', '\n'] }]).detect('a b')
		).toEqual([]);
		expect(detector.detect('why is checkout failing?')).toEqual([]);
		expect(detector.detect('')).toEqual([]);
	});

	it('works alongside the built-in detectors in detectAll', () => {
		const text = 'Falcon: email jane@northwind.com about Northwind';
		const spans = detectAll(text, [...defaultDetectors, detector]);
		expect(spans.map((s) => [text.slice(s.start, s.end), s.dataTypeId])).toEqual([
			['Falcon', CODENAMES],
			// The email rule is listed first, so the whole address stays personal data.
			['jane@northwind.com', BUILTIN_DATA_TYPE.personalData],
			['Northwind', CUSTOMERS]
		]);
	});
});
