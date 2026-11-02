import { describe, expect, it } from 'vitest';
import type { TermList } from '@safecontext/policy';
import { createTermListDetector, defaultDetectors, detectAll } from './index.ts';
import type { Detector } from './types.ts';
import { ALNUM, fill } from './test-helpers.ts';

/**
 * SPEC.md §4: tier 0 must take < 10 ms for 5 KB of text. We time the median of many runs, after
 * warm-up, so one slow run on a busy CI machine does not fail the build.
 */
const BUDGET_MS = 10;
const SIZE = 5 * 1024;
const RUNS = 25;

function medianMs(text: string, detectors: readonly Detector[] = defaultDetectors): number {
	for (let i = 0; i < 5; i++) detectAll(text, detectors); // let the JIT warm up
	const times: number[] = [];
	for (let i = 0; i < RUNS; i++) {
		const t0 = performance.now();
		detectAll(text, detectors);
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

// Not the 5 KB budget: a guard against rules that get slow (quadratic) on big tool output.
// Linear time on 1 MB is a few tens of milliseconds, so one second leaves room for slow CI.
describe('large inputs (1 MB) stay linear', () => {
	const MB = 1024 * 1024;
	const toMb = (unit: string) => unit.repeat(Math.ceil(MB / unit.length)).slice(0, MB);
	const LARGE: Record<string, string> = {
		'private key headers with no footer': toMb(`-----${'BEGIN'} PRIVATE KEY-----\nabc\n`),
		'private key headers with key lines': toMb(
			`-----${'BEGIN'} PRIVATE KEY-----\n${fill(ALNUM, 64)}\n`
		),
		'one long run of letters and digits': toMb(fill(ALNUM, 64)),
		'one long digit run': toMb('1234567890'),
		'many @ signs': toMb('a@b.'),
		'many colons': toMb('1a:2b:'),
		'almost-secret prefixes': toMb(
			`ghp_ AKIA sk-ant-api03- eyJ.eyJ. xoxb-1-1- ${fill(ALNUM, 20)} `
		),
		'realistic text': toMb(REALISTIC)
	};

	it.each(Object.entries(LARGE))('%s', (_name, text) => {
		const t0 = performance.now();
		detectAll(text);
		const elapsed = performance.now() - t0;
		console.info(`${_name}: ${elapsed.toFixed(0)} ms`);
		expect(elapsed).toBeLessThan(1000);
	});
});

// Issue #8: 10k admin terms over 5 KB of text stays < 10 ms.
describe(`term lists: 10k terms over 5 KB in < ${BUDGET_MS} ms (median of ${RUNS} runs)`, () => {
	// Deterministic pseudo-random words, so the term list is the same on every run.
	let seed = 42;
	const rand = (n: number) => {
		seed = (seed * 1103515245 + 12345) % 2 ** 31;
		return seed % n;
	};
	const word = () => {
		let w = String.fromCharCode(65 + rand(26));
		for (let i = 0, len = 3 + rand(8); i < len; i++) w += String.fromCharCode(97 + rand(26));
		return w;
	};
	const TERMS = Array.from({ length: 10_000 }, () =>
		Array.from({ length: 1 + rand(3) }, word).join(' ')
	);
	const LISTS: TermList[] = [
		{ dataTypeId: 'project-codenames', terms: TERMS.slice(0, 5_000) },
		{ dataTypeId: 'customer-names', terms: TERMS.slice(5_000) }
	];

	const t0 = performance.now();
	const termList = createTermListDetector(LISTS);
	const buildMs = performance.now() - t0;

	// Realistic text with a few terms mixed in.
	const WITH_TERMS = to5kb(
		[
			`Renewal call with ${TERMS[5_001]} went well; ${TERMS[3]} ships next sprint.\n`,
			`${TERMS[7_777]!.toUpperCase()}'s team asked about ${TERMS[1_234]} pricing.\n`,
			REALISTIC.slice(0, 400)
		].join('')
	);

	it('builds the matcher in reasonable time', () => {
		console.info(`10k terms: built in ${buildMs.toFixed(1)} ms`);
		expect(buildMs).toBeLessThan(1000);
	});

	it('finds the terms in the text', () => {
		const spans = termList.detect(WITH_TERMS);
		const matched = new Set(spans.map((s) => WITH_TERMS.slice(s.start, s.end).toLowerCase()));
		for (const i of [5_001, 3, 7_777, 1_234]) expect(matched).toContain(TERMS[i]!.toLowerCase());
	});

	const INPUTS: Record<string, string> = {
		'realistic text with terms': WITH_TERMS,
		'realistic text without terms': REALISTIC,
		// Every letter starts a partial match against some term.
		'term prefixes run together': to5kb(TERMS.slice(0, 50).join('').toLowerCase()),
		unicode: ADVERSARIAL.unicode!
	};

	it.each(Object.entries(INPUTS))('term list alone: %s', (_name, text) => {
		expect(text).toHaveLength(SIZE);
		const median = medianMs(text, [termList]);
		console.info(`term list, ${_name}: median ${median.toFixed(2)} ms`);
		expect(median).toBeLessThan(BUDGET_MS);
	});

	it('all tier 0 detectors plus 10k terms on realistic text', () => {
		const median = medianMs(WITH_TERMS, [...defaultDetectors, termList]);
		console.info(`all tier 0 + 10k terms: median ${median.toFixed(2)} ms`);
		expect(median).toBeLessThan(BUDGET_MS);
	});

	it('stays fast when every term nests inside the next (a, aa, aaa, ...)', () => {
		const nested = createTermListDetector([
			{
				dataTypeId: 'project-codenames',
				terms: Array.from({ length: 200 }, (_, i) => 'a'.repeat(i + 1))
			}
		]);
		expect(medianMs(to5kb('a'), [nested])).toBeLessThan(BUDGET_MS);
		expect(medianMs(to5kb('a '), [nested])).toBeLessThan(BUDGET_MS);
	});
});
