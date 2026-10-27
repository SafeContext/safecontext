/**
 * Admin term lists: exact matches for the terms IT uploads (project codenames, customer names).
 *
 * Matching is case-insensitive and whole-word: `Falcon` matches `falcon`, `FALCON,` and
 * `Falcon's`, but not `Falconry` or `unfalcon`. A term that starts or ends with punctuation
 * (`C++`, `.NET`) only needs a word boundary on its letter or digit edges. Words are letters,
 * marks, digits and `_` (like regex `\b`), so `falcon-api` contains `falcon` but `falcon_api`
 * does not.
 *
 * Text and terms are both "folded" first, so small spelling differences don't hide a match:
 * - case: full Unicode case (`MÜLLER` = `müller`, `STRASSE` = `straße`);
 * - whitespace: any run of spaces, tabs or line breaks counts as one space;
 * - apostrophes: curly and modifier apostrophes (`’`, `ʼ`) count as `'`.
 *
 * All terms go into one Aho-Corasick automaton (a trie with failure links), so scanning costs
 * one pass over the text however many terms there are. Build the detector once per policy.
 */
import type { TermList } from '@safecontext/policy';
import { mergeSpans } from './spans.ts';
import type { Detector, Span } from './types.ts';

const SPACE = 0x20;
const APOSTROPHE = 0x27;
/** Right/left single quote, modifier apostrophe, prime, fullwidth apostrophe. */
const APOSTROPHE_LIKE = new Set([0x2019, 0x2018, 0x02bc, 0x2032, 0xff07]);
const WORD = /^[\p{L}\p{M}\p{N}_]$/u;
const WHITESPACE = /^\s$/u;

// Caches for non-ASCII code points. Bounded by the size of Unicode.
const foldCache = new Map<number, string>();
const wordCache = new Map<number, boolean>();

/** Is the code point a letter, mark, digit or `_`? */
function isWordCodePoint(cp: number): boolean {
	if (cp < 0x80) {
		return (
			(cp >= 0x30 && cp <= 0x39) ||
			(cp >= 0x41 && cp <= 0x5a) ||
			(cp >= 0x61 && cp <= 0x7a) ||
			cp === 0x5f
		);
	}
	let word = wordCache.get(cp);
	if (word === undefined) {
		word = WORD.test(String.fromCodePoint(cp));
		wordCache.set(cp, word);
	}
	return word;
}

const isAsciiSpace = (cp: number) => cp === SPACE || (cp >= 0x09 && cp <= 0x0d);

/** Folded form of one non-ASCII code point (may be several code units, e.g. `ß` -> `ss`). */
function foldNonAscii(cp: number): string {
	let folded = foldCache.get(cp);
	if (folded === undefined) {
		const char = String.fromCodePoint(cp);
		if (WHITESPACE.test(char)) folded = ' ';
		else if (APOSTROPHE_LIKE.has(cp)) folded = "'";
		// Upper then lower approximates Unicode full case folding: ß -> SS -> ss, ς -> Σ -> σ.
		else folded = char.toUpperCase().toLowerCase();
		foldCache.set(cp, folded);
	}
	return folded;
}

/** Fold a term the same way the scanner folds text: case, apostrophes, collapsed whitespace. */
function foldTerm(term: string): string {
	let out = '';
	let lastWasSpace = true; // drops leading whitespace
	for (const char of term) {
		const cp = char.codePointAt(0)!;
		let folded: string;
		if (cp < 0x80) {
			if (isAsciiSpace(cp)) folded = ' ';
			else folded = cp >= 0x41 && cp <= 0x5a ? String.fromCharCode(cp + 32) : char;
		} else {
			folded = foldNonAscii(cp);
		}
		if (folded === ' ') {
			if (lastWasSpace) continue;
			lastWasSpace = true;
		} else {
			lastWasSpace = false;
		}
		out += folded;
	}
	return out.endsWith(' ') ? out.slice(0, -1) : out;
}

/** Is the code point ending just before `index` a word character? */
function isWordBefore(text: string, index: number): boolean {
	if (index <= 0) return false;
	let cp = text.charCodeAt(index - 1);
	if (cp >= 0xdc00 && cp <= 0xdfff && index >= 2) {
		const high = text.charCodeAt(index - 2);
		if (high >= 0xd800 && high <= 0xdbff) cp = text.codePointAt(index - 2)!;
	}
	return isWordCodePoint(cp);
}

/** Is the code point starting at `index` a word character? */
function isWordAt(text: string, index: number): boolean {
	return index < text.length && isWordCodePoint(text.codePointAt(index)!);
}

type Pattern = {
	/** Length of the folded term in UTF-16 code units. */
	length: number;
	dataTypeId: string;
	/** The term starts with a word character, so the text before the match must not. */
	wordStart: boolean;
};

/**
 * Aho-Corasick automaton over UTF-16 code units of folded terms. Node 0 is the root.
 * `output[node]` lists the patterns that end exactly at that node; `dict[node]` is the nearest
 * node on the failure chain that has outputs (0 if none), so reporting skips empty nodes.
 */
class Automaton {
	readonly patterns: Pattern[] = [];
	readonly maxLength: number;
	private readonly next: Map<number, number>[] = [new Map()];
	private readonly output: (number[] | undefined)[] = [undefined];
	private readonly fail: Int32Array;
	private readonly dict: Int32Array;

	constructor(lists: readonly TermList[]) {
		const seen = new Set<string>();
		let maxLength = 0;
		for (const list of lists) {
			for (const term of list.terms) {
				const folded = foldTerm(term);
				if (folded === '') continue;
				const key = `${list.dataTypeId}\u0000${folded}`;
				if (seen.has(key)) continue;
				seen.add(key);
				this.insert(folded, list.dataTypeId);
				maxLength = Math.max(maxLength, folded.length);
			}
		}
		this.maxLength = maxLength;

		// Breadth-first pass to set failure and dictionary links.
		const size = this.next.length;
		this.fail = new Int32Array(size);
		this.dict = new Int32Array(size);
		const queue: number[] = [];
		for (const child of this.next[0]!.values()) queue.push(child);
		for (let head = 0; head < queue.length; head++) {
			const node = queue[head]!;
			for (const [unit, child] of this.next[node]!) {
				let f = this.fail[node]!;
				while (f !== 0 && !this.next[f]!.has(unit)) f = this.fail[f]!;
				const target = this.next[f]!.get(unit);
				const failTo = target !== undefined && target !== child ? target : 0;
				this.fail[child] = failTo;
				this.dict[child] = this.output[failTo] !== undefined ? failTo : this.dict[failTo]!;
				queue.push(child);
			}
		}
	}

	private insert(folded: string, dataTypeId: string): void {
		let node = 0;
		for (let i = 0; i < folded.length; i++) {
			const unit = folded.charCodeAt(i);
			let child = this.next[node]!.get(unit);
			if (child === undefined) {
				child = this.next.length;
				this.next.push(new Map());
				this.output.push(undefined);
				this.next[node]!.set(unit, child);
			}
			node = child;
		}
		const first = folded.codePointAt(0)!;
		const id = this.patterns.length;
		this.patterns.push({ length: folded.length, dataTypeId, wordStart: isWordCodePoint(first) });
		(this.output[node] ??= []).push(id);
	}

	/** Follow one code unit from `state`. */
	step(state: number, unit: number): number {
		let s = state;
		for (;;) {
			const target = this.next[s]!.get(unit);
			if (target !== undefined) return target;
			if (s === 0) return 0;
			s = this.fail[s]!;
		}
	}

	/** Patterns ending at `state`, longest first, as a flat list of pattern ids via `visit`. */
	forEachMatch(state: number, visit: (patternId: number) => void): void {
		let node = this.output[state] !== undefined ? state : this.dict[state]!;
		while (node !== 0) {
			for (const id of this.output[node]!) visit(id);
			node = this.dict[node]!;
		}
	}

	hasMatch(state: number): boolean {
		return this.output[state] !== undefined || this.dict[state] !== 0;
	}
}

/**
 * Build a detector for the policy's term lists (`policy.lists`). Every match becomes a span with
 * that list's `dataTypeId`, `source: 'list'` and confidence 1.
 *
 * Overlapping matches are merged into one span covering all of them (see `mergeSpans`), so
 * nothing matched is left exposed. The merged span takes the data type of the longest match
 * starting first; for the same term in two lists, the list that comes first in `lists` wins.
 *
 * Building costs time proportional to the total length of all terms, so build once per policy
 * and reuse the detector. `detect` is one pass over the text.
 */
export function createTermListDetector(lists: readonly TermList[]): Detector {
	const automaton = new Automaton(lists);
	const { patterns, maxLength } = automaton;
	if (patterns.length === 0) return { id: 'term-list', detect: () => [] };

	return {
		id: 'term-list',
		detect(text) {
			const matches: { span: Span; id: number }[] = [];
			// starts[u % maxLength] = offset in `text` of the code point that produced folded unit u.
			const starts = new Int32Array(maxLength);
			let unitIndex = 0;
			let state = 0;
			let lastWasSpace = false;

			for (let i = 0; i < text.length;) {
				const cp = text.codePointAt(i)!;
				const end = i + (cp > 0xffff ? 2 : 1);

				let ascii = -1;
				let folded = '';
				if (cp < 0x80) {
					ascii = isAsciiSpace(cp) ? SPACE : cp >= 0x41 && cp <= 0x5a ? cp + 32 : cp;
				} else {
					folded = foldNonAscii(cp);
					if (folded === ' ') ascii = SPACE;
					else if (folded === "'") ascii = APOSTROPHE;
				}

				if (ascii === SPACE) {
					if (lastWasSpace) {
						i = end;
						continue;
					}
					lastWasSpace = true;
				} else {
					lastWasSpace = false;
				}

				const count = ascii >= 0 ? 1 : folded.length;
				for (let k = 0; k < count; k++) {
					const unit = ascii >= 0 ? ascii : folded.charCodeAt(k);
					starts[unitIndex % maxLength] = i;
					state = automaton.step(state, unit);
					if (automaton.hasMatch(state)) {
						// Every match here ends with this code point, so one end-boundary check covers
						// them all: a word character followed by another means we're mid-word.
						if (!(isWordCodePoint(cp) && isWordAt(text, end))) {
							const lastUnit = unitIndex;
							automaton.forEachMatch(state, (id) => {
								const pattern = patterns[id]!;
								const start = starts[(lastUnit - pattern.length + 1) % maxLength]!;
								if (pattern.wordStart && isWordBefore(text, start)) return;
								const span: Span = {
									start,
									end,
									dataTypeId: pattern.dataTypeId,
									source: 'list',
									confidence: 1
								};
								matches.push({ span, id });
							});
						}
					}
					unitIndex++;
				}
				i = end;
			}
			// mergeSpans lets the earliest input win, so order by start, longest first, then list order.
			matches.sort((a, b) => a.span.start - b.span.start || b.span.end - a.span.end || a.id - b.id);
			return mergeSpans(matches.map((m) => m.span));
		}
	};
}
