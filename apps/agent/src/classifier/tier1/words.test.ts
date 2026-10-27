import { describe, expect, it } from 'vitest';
import { decode, splitWords, windows } from './words.ts';

describe('splitWords', () => {
	it('matches the Python splitter: hyphen/underscore words stay whole, punctuation splits', () => {
		const words = splitWords('Hi, build-07.corp (a_b) $4.2M');
		expect(words.map((w) => w.text)).toEqual([
			'Hi',
			',',
			'build-07',
			'.',
			'corp',
			'(',
			'a_b',
			')',
			'$',
			'4',
			'.',
			'2M'
		]);
	});

	it('keeps UTF-16 offsets into the original text', () => {
		const text = 'Café 🙂 Müller';
		for (const w of splitWords(text)) expect(text.slice(w.start, w.end)).toBe(w.text);
	});
});

describe('windows', () => {
	const limits = { maxWords: 4, maxTokens: 100, overlap: 1 };

	it('is one window when everything fits', () => {
		expect(windows([1, 1, 1], limits)).toEqual([[0, 3]]);
		expect(windows([], limits)).toEqual([]);
	});

	it('splits by word count, sharing `overlap` words', () => {
		expect(windows([1, 1, 1, 1, 1, 1, 1], limits)).toEqual([
			[0, 4],
			[3, 7]
		]);
	});

	it('splits by token count, and gives an over-long word a window of its own', () => {
		expect(windows([40, 40, 40, 500, 10], { ...limits, overlap: 0 })).toEqual([
			[0, 2],
			[2, 3],
			[3, 4],
			[4, 5]
		]);
	});

	it('always moves forward, even when the overlap is as big as a window', () => {
		expect(windows([60, 60, 60], { maxWords: 4, maxTokens: 100, overlap: 5 })).toEqual([
			[0, 1],
			[1, 2],
			[2, 3]
		]);
	});
});

describe('decode', () => {
	// 3 words, maxWidth 2, 2 labels: logits laid out [word][width][label]
	const words = splitWords('Priya Raman left');
	const at = (s: number, w: number, k: number) => (s * 2 + w) * 2 + k;
	const blank = () => new Float32Array(3 * 2 * 2).fill(-10);

	it('keeps the highest-scoring of overlapping spans', () => {
		const logits = blank();
		logits[at(0, 1, 0)] = 3; // "Priya Raman" as label 0
		logits[at(0, 0, 1)] = 1; // "Priya" as label 1 (overlaps, lower score)
		const spans = decode(logits, words, 2, 2, 0.5);
		expect(spans).toEqual([{ start: 0, end: 11, label: 0, score: expect.closeTo(0.95, 2) }]);
	});

	it('drops scores under the threshold', () => {
		const logits = blank();
		logits[at(2, 0, 1)] = 0.1; // sigmoid ≈ 0.52
		expect(decode(logits, words, 2, 2, 0.6)).toEqual([]);
		expect(decode(logits, words, 2, 2, 0.5)).toHaveLength(1);
	});

	it('ignores spans that run past the last word', () => {
		const logits = blank();
		logits[at(2, 1, 0)] = 9; // word 2 + width 1 = word 3, which does not exist
		expect(decode(logits, words, 2, 2, 0.5)).toEqual([]);
	});
});
