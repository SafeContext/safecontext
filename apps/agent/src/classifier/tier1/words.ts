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
}

/** Same split as Python gliner's WhitespaceTokenSplitter: `\w+(?:[-_]\w+)*|\S`. */
export function splitWords(text: string): Word[] {
	const pattern = /[\p{L}\p{M}\p{N}_]+(?:[-_][\p{L}\p{M}\p{N}_]+)*|\S/gu;
	return [...text.matchAll(pattern)].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
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
 * `threshold`, highest first, dropping any that overlaps one already kept.
 */
export function decode(
	logits: ArrayLike<number>,
	words: readonly Word[],
	labelCount: number,
	maxWidth: number,
	threshold: number
): Scored[] {
	const n = words.length;
	const found: Array<Scored & { first: number; last: number }> = [];
	for (let s = 0; s < n; s++) {
		for (let w = 0; w < maxWidth && s + w < n; w++) {
			const base = (s * maxWidth + w) * labelCount;
			for (let k = 0; k < labelCount; k++) {
				const score = sigmoid(logits[base + k]!);
				if (score >= threshold) {
					found.push({ start: words[s]!.start, end: words[s + w]!.end, label: k, score, first: s, last: s + w });
				}
			}
		}
	}
	found.sort((a, b) => b.score - a.score);
	const kept: typeof found = [];
	for (const c of found) {
		if (!kept.some((k) => c.first <= k.last && k.first <= c.last)) kept.push(c);
	}
	return kept
		.sort((a, b) => a.start - b.start || a.end - b.end || a.label - b.label)
		.map(({ start, end, label, score }) => ({ start, end, label, score }));
}
