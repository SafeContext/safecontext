import { describe, expect, it } from 'vitest';
import { decode, recordLines, splitWords, windows } from './words.ts';

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

	it('marks the first word after a line break (#106)', () => {
		const words = splitWords('a b\nc\r\nd  e');
		expect(words.map((w) => (w.newLine ? `|${w.text}` : w.text))).toEqual(['a', 'b', '|c', '|d', 'e']);
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

	it('never keeps a span across a line break, so the spans on each line win (#106)', () => {
		// "0123⏎Acme Corp": the phone's last digits and the next CSV row's customer name
		const lines = splitWords('0123\nAcme Corp');
		const at3 = (s: number, w: number, k: number) => (s * 3 + w) * 2 + k;
		const logits = new Float32Array(3 * 3 * 2).fill(-10);
		logits[at3(0, 2, 0)] = 9; // "0123⏎Acme Corp" as label 0: would win, crosses the line
		logits[at3(0, 0, 0)] = 3; // "0123" as label 0
		logits[at3(1, 1, 1)] = 4; // "Acme Corp" as label 1
		const spans = decode(logits, lines, 2, 3, 0.5);
		expect(spans.map((s) => ['0123\nAcme Corp'.slice(s.start, s.end), s.label])).toEqual([
			['0123', 0],
			['Acme Corp', 1]
		]);
	});

	it('keeps an entity written over two lines, as one piece per line (#106)', () => {
		const text = '22 Kiln Street,\nRaleigh';
		const lines = splitWords(text); // 22 Kiln Street , ⏎Raleigh
		const at5 = (s: number, w: number) => s * 5 + w; // maxWidth 5, 1 label
		const logits = new Float32Array(5 * 5).fill(-10);
		logits[at5(0, 4)] = 4; // the whole address
		const spans = decode(logits, lines, 1, 5, 0.5);
		expect(spans.map((s) => text.slice(s.start, s.end))).toEqual(['22 Kiln Street,', 'Raleigh']);
	});

	it('never splits a span over lines into table rows, where each line is a record', () => {
		const text = '22,Kiln,Street,OH\nRaleigh,NC,27648,US';
		const words = splitWords(text);
		expect(words.every((w) => w.record)).toBe(true);
		const logits = new Float32Array(words.length * 5).fill(-10);
		logits[6 * 5 + 1] = 4; // "OH ⏎ Raleigh" (word 6, width 1) crosses two rows
		expect(decode(logits, words, 1, 5, 0.5)).toEqual([]);
	});

	it('ignores spans that run past the last word', () => {
		const logits = blank();
		logits[at(2, 1, 0)] = 9; // word 2 + width 1 = word 3, which does not exist
		expect(decode(logits, words, 2, 2, 0.5)).toEqual([]);
	});
});

describe('recordLines', () => {
	it('spots CSV, TSV and pipe tables, not prose with commas', () => {
		expect(recordLines(['account,arr,stage,close', 'Northwind,1350000,Renewal,2027-01-31'])).toEqual([true, true]);
		expect(recordLines(['a\tb\tc', '1\t2\t3'])).toEqual([true, true]);
		expect(recordLines(['| Revenue | $4.2M |', '| Margin | 71% |'])).toEqual([true, true]);
		expect(
			recordLines([
				'@omar refund for Hanne Bramwell, card 5105, billing address 22 Kiln Street, Raleigh, NC 27648',
				'@omar Project Halyard shipped publicly last year, nice work'
			])
		).toEqual([false, false]);
		expect(recordLines(['one, two, three, four'])).toEqual([false]);
	});
});
