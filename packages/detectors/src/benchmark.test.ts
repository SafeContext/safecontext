import { describe, expect, it } from 'vitest';
import { detectAll } from './index.ts';
import { ALNUM, fill } from './test-helpers.ts';

/**
 * SPEC.md §4: tier 0 must take < 10 ms for 5 KB of text. We time the median of many runs, after
 * warm-up, so one slow run on a busy CI machine does not fail the build.
 */
const BUDGET_MS = 10;
const SIZE = 5 * 1024;
const RUNS = 25;

function medianMs(text: string): number {
	for (let i = 0; i < 5; i++) detectAll(text); // let the JIT warm up
	const times: number[] = [];
	for (let i = 0; i < RUNS; i++) {
		const t0 = performance.now();
		detectAll(text);
		times.push(performance.now() - t0);
	}
	times.sort((a, b) => a - b);
	return times[Math.floor(RUNS / 2)]!;
}

/** Repeat `unit` until the text is exactly 5 KB. */
const to5kb = (unit: string) => unit.repeat(Math.ceil(SIZE / unit.length)).slice(0, SIZE);

const REALISTIC = to5kb(
	[
		'2024-03-05T10:20:30Z INFO checkout failed for jane@northwind.com from 203.0.113.42 (order 8841)\n',
		'Call (415) 555-0132 or +44 20 7946 0958. Card 4242 4242 4242 4242 was declined.\n',
		`export GITHUB_TOKEN=ghp_${fill(ALNUM, 36)}\n`,
		'const total = items.reduce((sum, item) => sum + item.price * item.qty, 0); // v1.2.3\n',
		'Quarterly review notes: the launch is on track and the team shipped 14 fixes this week.\n'
	].join('')
);

// Inputs that make naive regexes slow: long runs that almost match many rules.
const ADVERSARIAL: Record<string, string> = {
	'one long digit run': to5kb('1234567890'),
	'one long run of letters and digits': to5kb(fill(ALNUM, 64)),
	'dots and dashes': to5kb('a.b-c.'),
	'many @ signs': to5kb('a@b.'),
	'many colons': to5kb('1a:2b:'),
	'many private key headers, no end': to5kb(`-----${'BEGIN'} PRIVATE KEY-----\nabc\n`),
	'almost-secret prefixes': to5kb(`ghp_ AKIA sk-ant-api03- eyJ.eyJ. xoxb-1-1- ${fill(ALNUM, 20)} `),
	'dotted numbers': to5kb('10.20.30.40.50 192.168.1. 1.2.3 '),
	unicode: to5kb('héllo wörld — 日本語のテキスト 🙂 ')
};

describe(`benchmark: 5 KB in < ${BUDGET_MS} ms (median of ${RUNS} runs)`, () => {
	it('is 5 KB of realistic text', () => {
		expect(REALISTIC).toHaveLength(SIZE);
		const median = medianMs(REALISTIC);
		console.info(`realistic 5 KB: median ${median.toFixed(2)} ms`);
		expect(median).toBeLessThan(BUDGET_MS);
	});

	it.each(Object.entries(ADVERSARIAL))('stays fast on %s', (_name, text) => {
		expect(text).toHaveLength(SIZE);
		expect(medianMs(text)).toBeLessThan(BUDGET_MS);
	});
});
