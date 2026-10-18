import { describe, expect, it } from 'vitest';
import { defaultDetectors, detectAll, mergeSpans, type Detector, type Span } from './index.ts';
import { ALNUM, fill } from './test-helpers.ts';

const span = (start: number, end: number, dataTypeId = 'a', confidence = 1): Span => ({
	start,
	end,
	dataTypeId,
	source: 'rule',
	confidence
});

describe('mergeSpans', () => {
	it('returns nothing for nothing', () => {
		expect(mergeSpans([])).toEqual([]);
	});

	it('sorts spans and keeps separate ones apart, including ones that only touch', () => {
		expect(mergeSpans([span(20, 30), span(0, 5), span(5, 10)])).toEqual([
			span(0, 5),
			span(5, 10),
			span(20, 30)
		]);
	});

	it('joins overlapping spans into one covering all of them', () => {
		expect(mergeSpans([span(0, 10), span(5, 15), span(14, 20)])).toEqual([span(0, 20)]);
	});

	it('absorbs a span that sits inside another', () => {
		expect(mergeSpans([span(2, 4), span(0, 10)])).toEqual([span(0, 10)]);
	});

	it('keeps the data type of the earlier input when confidence is equal', () => {
		const merged = mergeSpans([span(0, 10, 'secrets'), span(2, 30, 'customer-personal-data')]);
		expect(merged).toEqual([span(0, 30, 'secrets')]);
	});

	it('lets higher confidence win over input order', () => {
		const merged = mergeSpans([span(0, 10, 'first', 0.5), span(5, 15, 'second', 0.9)]);
		expect(merged).toEqual([span(0, 15, 'second', 0.9)]);
	});

	it('does not change its input', () => {
		const input = [span(0, 10), span(5, 15)];
		mergeSpans(input);
		expect(input).toEqual([span(0, 10), span(5, 15)]);
	});
});

describe('detectAll', () => {
	it('returns nothing for safe text', () => {
		expect(detectAll('why is checkout failing for some users?')).toEqual([]);
		expect(detectAll('')).toEqual([]);
	});

	it('finds every kind of data in one pass, sorted, with the right data types', () => {
		const token = `ghp_${fill(ALNUM, 36)}`;
		const text = [
			`mail jane@northwind.com`,
			`call (415) 555-0132`,
			`card 4242 4242 4242 4242`,
			`from 203.0.113.42`,
			`using ${token}`
		].join('\n');
		const spans = detectAll(text);
		expect(spans.map((s) => [text.slice(s.start, s.end), s.dataTypeId])).toEqual([
			['jane@northwind.com', 'customer-personal-data'],
			['(415) 555-0132', 'customer-personal-data'],
			['4242 4242 4242 4242', 'customer-personal-data'],
			['203.0.113.42', 'customer-personal-data'],
			[token, 'secrets']
		]);
		for (let i = 1; i < spans.length; i++) {
			expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
		}
	});

	it('reports a number two rules both match only once', () => {
		const text = 'ring +1 (415) 555-0132 now';
		const spans = detectAll(text);
		expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['+1 (415) 555-0132']);
	});

	it('keeps a secret a secret when part of it also looks like an email', () => {
		const text = `git clone https://ci:ghp_${fill(ALNUM, 36)}@github.com/acme/app.git`;
		const spans = detectAll(text);
		expect(spans).toHaveLength(1);
		expect(spans[0]!.dataTypeId).toBe('secrets');
		// The merged span covers the email-looking part too, so nothing is left exposed.
		expect(text.slice(spans[0]!.start, spans[0]!.end)).toContain('@github.com');
	});

	it('runs extra detectors, such as admin term lists (issue #8), alongside the built-in ones', () => {
		const codename: Detector = {
			id: 'codename-list',
			detect(text) {
				const start = text.indexOf('Project Atlas');
				return start < 0
					? []
					: [
							{
								start,
								end: start + 13,
								dataTypeId: 'unreleased-roadmap',
								source: 'list',
								confidence: 1
							}
						];
			}
		};
		const text = 'Project Atlas owner: jane@northwind.com';
		const spans = detectAll(text, [...defaultDetectors, codename]);
		expect(spans.map((s) => [text.slice(s.start, s.end), s.dataTypeId, s.source])).toEqual([
			['Project Atlas', 'unreleased-roadmap', 'list'],
			['jane@northwind.com', 'customer-personal-data', 'rule']
		]);
	});

	it('can run with no detectors', () => {
		expect(detectAll('jane@northwind.com', [])).toEqual([]);
	});
});
