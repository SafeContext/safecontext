/**
 * The model-independent parts of the GLiNER tagger (tier 1): splitting text into words, cutting
 * long texts into windows the model can take, and turning the model's scores into spans.
 * Ported from the issue #5 spike (`scripts/gliner/gliner.ts`), which matched Python `gliner`
 * 0.2.29 span for span.
 */

export interface Word {
	text: string;
	/** UTF-16 offsets into the original text. */
	start: number;
	end: number;
	/** A line break comes between this word and the one before it. */
	newLine?: boolean;
	/** The word's line looks like a table row (CSV, TSV, pipe table): see `isRecordLine`. */
	record?: boolean;
}

/** A line holding 2 or more of the same separator: one record of a CSV, TSV or pipe table. */
export function isRecordLine(line: string): boolean {
	return [',', '\t', '|', ';'].some((sep) => line.split(sep).length > 3 || (sep !== ',' && line.split(sep).length > 2));
}

/** Same split as Python gliner's WhitespaceTokenSplitter: `\w+(?:[-_]\w+)*|\S`. */
export function splitWords(text: string): Word[] {
	const pattern = /[\p{L}\p{M}\p{N}_]+(?:[-_][\p{L}\p{M}\p{N}_]+)*|\S/gu;
	const lineBreak = /\r\n|[\n\r\u2028\u2029]/g;
	const recordAt = (offset: number) => {
		const start = Math.max(...['\n', '\r', '\u2028', '\u2029'].map((c) => text.lastIndexOf(c, offset - 1))) + 1;
		const rest = text.slice(start).search(/[\n\r\u2028\u2029]/);
		return isRecordLine(text.slice(start, rest === -1 ? undefined : start + rest));
	};
	let previousEnd = 0;
	let record = recordAt(0);
	return [...text.matchAll(pattern)].map((m) => {
		const word: Word = { text: m[0], start: m.index, end: m.index + m[0].length };
		if (lineBreak.test(text.slice(previousEnd, m.index))) {
			word.newLine = true;
			record = recordAt(m.index);
		}
		lineBreak.lastIndex = 0;
		if (record) word.record = true;
		previousEnd = word.end;
		return word;
	});
}

export interface WindowLimits {
	/** Most words per window (gliner_config `max_len`). */
	maxWords: number;
	/** Most text tokens per window, after the label prompt and special tokens. */
	maxTokens: number;
	/** Words shared by neighbouring windows, so an entity on the edge is still seen whole. */
	overlap: number;
}

/**
 * Cut `tokenCounts.length` words into `[start, end)` windows within the limits. A single word
 * longer than `maxTokens` gets a window of its own (the caller truncates its tokens).
 */
export function windows(
	tokenCounts: readonly number[],
	{ maxWords, maxTokens, overlap }: WindowLimits
): Array<[number, number]> {
	const n = tokenCounts.length;
	const out: Array<[number, number]> = [];
	let start = 0;
	while (start < n) {
		let end = start;
		let tokens = 0;
		while (end < n && end - start < maxWords && (end === start || tokens + tokenCounts[end]! <= maxTokens)) {
			tokens += tokenCounts[end]!;
			end++;
		}
		out.push([start, end]);
		if (end >= n) break;
		start = Math.max(start + 1, end - overlap);
	}
	return out;
}

export interface Scored {
	start: number;
	end: number;
	/** Index into the labels passed to the model. */
	label: number;
	score: number;
}

const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/**
 * Turn the model's logits for one window, laid out `[word][width][label]`, into spans
 * (flat NER, like Python gliner): every (start word, width, label) scoring at least
 * `threshold`, highest first, dropping any that overlaps one already kept. Unlike Python
 * gliner, no span crosses a line break (#106): spans within a line win first, and a span over
 * several lines is only used where nothing else was found, cut into one piece per line.
 */
export function decode(
	logits: ArrayLike<number>,
	words: readonly Word[],
	labelCount: number,
	maxWidth: number,
	threshold: number
): Scored[] {
	type Found = Scored & { first: number; last: number };
	const n = words.length;
	const inLine: Found[] = [];
	const crossing: Found[] = [];
	for (let s = 0; s < n; s++) {
		let crosses = false;
		for (let w = 0; w < maxWidth && s + w < n; w++) {
			if (w > 0 && words[s + w]!.newLine) crosses = true;
			const base = (s * maxWidth + w) * labelCount;
			for (let k = 0; k < labelCount; k++) {
				const score = sigmoid(logits[base + k]!);
				if (score >= threshold) {
					const span = { start: words[s]!.start, end: words[s + w]!.end, label: k, score, first: s, last: s + w };
					(crosses ? crossing : inLine).push(span);
				}
			}
		}
	}
	const kept: Found[] = [];
	const free = (c: { first: number; last: number }) => !kept.some((k) => c.first <= k.last && k.first <= c.last);
	// Spans within one line first, so each row, list item or heading gets its own (#106).
	for (const c of inLine.sort((a, b) => b.score - a.score)) if (free(c)) kept.push(c);
	// Then an entity written over two lines (a postal address) where nothing else was found:
	// kept as one piece per line, so the line breaks survive. Never across table rows, where
	// each line is its own record.
	for (const c of crossing.sort((a, b) => b.score - a.score)) {
		if (!free(c) || words.slice(c.first, c.last + 1).some((w) => w.record)) continue;
		let from = c.first;
		for (let i = c.first + 1; i <= c.last + 1; i++) {
			if (i > c.last || words[i]!.newLine) {
				kept.push({ ...c, start: words[from]!.start, end: words[i - 1]!.end, first: from, last: i - 1 });
				from = i;
			}
		}
	}
	return kept
		.sort((a, b) => a.start - b.start || a.end - b.end || a.label - b.label)
		.map(({ start, end, label, score }) => ({ start, end, label, score }));
}
