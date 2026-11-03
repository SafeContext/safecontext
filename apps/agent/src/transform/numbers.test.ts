/** The cases of `ml/tests/test_tier2.py` (numbers section), so the port behaves like the Python. */
import { describe, expect, it } from 'vitest';
import { isTrue, leaksValue, parseValue, pyG, ruleRewrite, tooPrecise } from './numbers.ts';
import { checkFormat } from './generalize.ts';

describe('parseValue', () => {
	it.each([
		['$4.2M', 4.2e6, 'money', 2],
		['18%', 18, 'percent', 2],
		['-3.2%', -3.2, 'percent', 2],
		['€34,679,000', 34_679_000, 'money', 5],
		['340 ms', 340, 'duration_ms', 2],
		['12,946', 12946, 'count', 5],
		['143.3k', 143_300, 'count', 4],
		['$0.2 million', 200_000, 'money', 1],
		['£33.5 million', 33.5e6, 'money', 3]
	] as const)('%s', (text, value, kind, sig) => {
		const v = parseValue(text)!;
		expect(v.value).toBeCloseTo(value, 6);
		expect(v.kind).toBe(kind);
		expect(v.sig).toBe(sig);
	});
});

describe('isTrue', () => {
	it.each([
		['high teens', '18%', true],
		['mid-teens', '18%', false],
		['high teens', '29.6%', false],
		['high twenties', '29.6%', true],
		['under 1%', '0.8%', true],
		['about $4M', '$4.2M', true],
		['over $1M', '$1,474,000', true],
		['low six figures', '$134k', true],
		['low six figures', '$3.5M', false],
		['a few million dollars', '$3.6M', true],
		['tens of millions', '$48.1M', true],
		['single digits', '6.4%', true],
		['mid single digits', '6.4%', true],
		['low single digits', '6.4%', false],
		['over half', '62%', true],
		['around a third', '30.7%', true],
		['between $1M and $2M', '$1.5M', true],
		['$1-2M', '$2.5M', false],
		['a few hundred ms', '340 ms', true],
		['nearly 1,000', '980', true],
		['nearly 1,000', '1,200', false],
		['strong growth', '18%', undefined]
	] as const)('%s for %s', (rewrite, original, expected) => {
		expect(isTrue(rewrite, parseValue(original)!)).toBe(expected);
	});
});

describe('leaksValue and tooPrecise', () => {
	it.each([
		['about $4.2M', '$4.2M', true, false],
		['4.2 million dollars', '$4.2M', true, false],
		['about $4M', '$4.2M', false, false],
		['about 70%', '70%', true, false],
		['about 70%', '69%', false, false],
		['about 13,000', '12,946', false, true],
		['high teens', '18%', false, false]
	] as const)('%s for %s', (rewrite, original, leak, precise) => {
		const v = parseValue(original)!;
		expect(leaksValue(rewrite, v, original)).toBe(leak);
		expect(tooPrecise(rewrite, v) === precise || leak).toBe(true);
	});
});

describe('ruleRewrite', () => {
	it.each([
		'$4.2M',
		'18%',
		'12,946',
		'$2M',
		'30%',
		'0.8%',
		'146.9k',
		'340 ms',
		'$1,474,000',
		'7%',
		'-3.2%',
		'99.95%',
		'£0.2 million'
	])('%s: true, vague and never leaks', (span) => {
		const r = ruleRewrite(span)!;
		const v = parseValue(span)!;
		expect(r).toBeTruthy();
		expect(isTrue(r, v)).toBe(true);
		expect(leaksValue(r, v, span)).toBe(false);
		expect(tooPrecise(r, v)).toBe(false);
		expect(checkFormat(r, span)).toBe(true);
	});

	it.each(['Project Heron', 'March 3, 2026', 'Q2 2027', '2027-03-12', '$4.2M ARR', 'v2.4'])(
		'%s: not one number, so no rule rewrite',
		(span) => {
			expect(ruleRewrite(span)).toBeUndefined();
		}
	);

	it('gives the same wording as the Python reference', () => {
		expect(ruleRewrite('$4.2M')).toBe('over $4M');
		expect(ruleRewrite('18%')).toBe('high teens');
		expect(ruleRewrite('12,946')).toBe('over 10,000');
		expect(ruleRewrite('$2M')).toBe('under $3M');
		expect(ruleRewrite('0.8%')).toBe('under 1%');
		expect(ruleRewrite('-3.2%')).toBe('down single digits');
		expect(ruleRewrite('340 ms')).toBe('over 300 ms');
		expect(ruleRewrite('£0.2 million')).toBe('under £300k');
		expect(ruleRewrite('€865k')).toBe('over €800k');
	});
});

describe("pyG (Python's :g)", () => {
	it.each([
		[4, '4'],
		[400, '400'],
		[0.5, '0.5'],
		[1e6, '1e+06'],
		[123456, '123456'],
		[0.0001, '0.0001'],
		[0.00001, '1e-05']
	])('%d', (x, s) => expect(pyG(x)).toBe(s));
});
