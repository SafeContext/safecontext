/**
 * Numbers in sensitive spans and in their vague rewrites: parse, compare, bucket. A TypeScript
 * port of `ml/src/safecontext_ml/tier2/numbers.py` (issue #14), which scored the deterministic
 * rewrite at 100% clean (true, vague, no leak) on the test split. Keep the two in step: the
 * cases in `numbers.test.ts` are the Python tests' cases.
 *
 * - `parseValue("$4.2M")` → { value: 4_200_000, kind: "money", ... }
 * - `parseNumbers(text)`: every number written in a rewrite
 * - `claimedRange(rewrite, value)` / `isTrue`: the interval a rewrite like "high teens" or
 *   "over $4M" claims, and whether the value is inside it
 * - `leaksValue` / `tooPrecise`: does a rewrite give the value away
 * - `ruleRewrite(span)`: the deterministic generalize ("$4.2M" → "over $4M", "18%" → "high teens")
 *
 * Heuristics for English business text, not a general number parser.
 */

const MAG: Record<string, number> = {
	k: 1e3,
	thousand: 1e3,
	thousands: 1e3,
	hundreds: 1e2,
	m: 1e6,
	mm: 1e6,
	mn: 1e6,
	million: 1e6,
	millions: 1e6,
	b: 1e9,
	bn: 1e9,
	billion: 1e9,
	billions: 1e9
};
const CURRENCY = '$€£¥';

/** A number with optional currency, sign, thousands separators, decimals, magnitude and unit. */
const NUM_SOURCE =
	String.raw`(?<cur>[$€£¥])?\s?(?<sign>[-−+])?(?<cur2>[$€£¥])?` +
	String.raw`(?<num>\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)` +
	String.raw`(?:\s?(?<mag>thousand|millions?|billions?|bn|mn|mm|[kKmMbB])\b)?` +
	String.raw`\s?(?<unit>%|percent\b|pts?\b|ms\b|s\b|seconds?\b|x\b)?`;
const NUM_FULL = new RegExp(`^(?:${NUM_SOURCE})$`);
const numGlobal = () => new RegExp(NUM_SOURCE, 'g');

export type ValueKind = 'percent' | 'money' | 'duration_ms' | 'count';

export interface Value {
	value: number;
	kind: ValueKind;
	/** The digits as written, without separators ("4.2", "34679000"). */
	digits: string;
	/** Significant digits as written ("4.2" → 2, "13,000" → 2, "70" → 1). */
	sig: number;
}

function sigDigits(num: string): number {
	const d = num.replaceAll(',', '');
	if (d.includes('.')) return d.replace('.', '').replace(/^0+/, '').length || 1;
	return d.replace(/^0+/, '').replace(/0+$/, '').length || 1;
}

function toValue(groups: Record<string, string | undefined>): Value {
	const num = groups.num!;
	let v = Number(num.replaceAll(',', ''));
	const mag = (groups.mag ?? '').toLowerCase();
	v *= MAG[mag] ?? 1;
	const unit = (groups.unit ?? '').toLowerCase();
	if (groups.sign === '-' || groups.sign === '−') v = -v;
	let kind: ValueKind;
	if (['%', 'percent', 'pt', 'pts'].includes(unit)) kind = 'percent';
	else if (groups.cur || groups.cur2) kind = 'money';
	else if (unit === 'ms') kind = 'duration_ms';
	else if (['s', 'second', 'seconds'].includes(unit)) {
		kind = 'duration_ms';
		v *= 1000;
	} else kind = 'count';
	return { value: v, kind, digits: num.replaceAll(',', ''), sig: sigDigits(num) };
}

/** The value of a sensitive number span ("$4.2M", "18%", "-3.2%", "340 ms", "12,946"). */
export function parseValue(spanText: string): Value | undefined {
	const m = numGlobal().exec(spanText);
	return m?.groups ? toValue(m.groups) : undefined;
}

/** Every number written in `text`. */
export function parseNumbers(text: string): Value[] {
	return [...text.matchAll(numGlobal())].map((m) => toValue(m.groups!));
}

// --- the interval a vague phrase claims ---

const DECADES: Record<string, number> = {
	teens: 10,
	twenties: 20,
	thirties: 30,
	forties: 40,
	fifties: 50,
	sixties: 60,
	seventies: 70,
	eighties: 80,
	nineties: 90
};
const FIGURES: Record<string, number> = { four: 3, five: 4, six: 5, seven: 6, eight: 7, nine: 8, ten: 9 };
const FRACTIONS: Array<[string, number]> = [
	['half', 50.0],
	['a third', 100 / 3],
	['one third', 100 / 3],
	['two thirds', 200 / 3],
	['two-thirds', 200 / 3],
	['a quarter', 25.0],
	['three quarters', 75.0],
	['three-quarters', 75.0],
	['a fifth', 20.0],
	['a tenth', 10.0]
];
const LOW_MID_HIGH: Record<string, [number, number]> = { low: [0.0, 0.4], mid: [0.3, 0.7], high: [0.6, 1.0] };

const ABOVE =
	'(?:over|more than|above|exceeding|at least|upwards of|north of|beyond|greater than|in excess of)';
const BELOW = '(?:under|less than|below|up to|at most|fewer than|no more than|sub-?)';
/** How far "about N" may be from N, relative (one significant digit rounds by up to ~±35%). */
export const ABOUT_TOLERANCE = 0.4;

function bounds(word: string, base: number, width: number): [number, number] {
	const [lo, hi] = LOW_MID_HIGH[word]!;
	return [base + lo * width, base + hi * width];
}

/**
 * The interval [lo, hi] the rewrite claims for the value, in the original's units, or undefined
 * if no rule applies. Signs are ignored ("down 3%" and "-3%" both compare 3).
 */
export function claimedRange(rewrite: string, original: Value): [number, number] | undefined {
	const s = rewrite.toLowerCase().replaceAll('‑', '-').replaceAll('–', '-');
	const targetKind = original.kind;

	// "low/mid/high teens", "high twenties", "teens"
	let m = /\b(?:(low|mid|high)[- ])?(teens|twenties|thirties|forties|fifties|sixties|seventies|eighties|nineties)\b/.exec(
		s
	);
	if (m && targetKind === 'percent') {
		const base = DECADES[m[2]!]!;
		return m[1] ? bounds(m[1], base, 10) : [base, base + 10];
	}
	// "single digits", "low single digits", "double digits"
	m = /\b(?:(low|mid|high)[- ])?(single|double|triple)[- ]digits?\b/.exec(s);
	if (m) {
		let [lo, hi] = ({ single: [0, 10], double: [10, 100], triple: [100, 1000] } as const)[
			m[2] as 'single' | 'double' | 'triple'
		];
		if (m[1]) [lo, hi] = bounds(m[1], lo, hi - lo) as [0, 10];
		return [lo, hi];
	}
	// "six figures", "low seven-figure"
	m = /\b(?:(low|mid|high)[- ])?(four|five|six|seven|eight|nine|ten)[- ]figures?\b/.exec(s);
	if (m) {
		let lo = 10 ** FIGURES[m[2]!]!;
		let hi = lo * 10;
		if (m[1]) {
			[lo, hi] = ({ low: [lo, 4 * lo], mid: [3 * lo, 7 * lo], high: [6 * lo, hi] } as Record<string, [number, number]>)[
				m[1]
			]!;
		}
		return [lo, hi];
	}
	// "tens of millions", "hundreds of thousands", "a few million", "several million", "millions"
	m = /\b(tens|hundreds) of (thousands|millions|billions)\b/.exec(s);
	if (m) {
		const unit = MAG[m[2]!]!;
		const lo = unit * (m[1] === 'tens' ? 10 : 100);
		return [lo, lo * 10];
	}
	m = /\b(a few|a couple of|several|a handful of)\s+(hundred|thousand|million|billion)s?\b/.exec(s);
	if (m) {
		const unit = m[2] === 'hundred' ? 100.0 : MAG[m[2]!]!;
		const [lo, hi] = (
			{ 'a few': [2, 10], 'a couple of': [1.5, 3], several: [3, 10], 'a handful of': [2, 10] } as Record<
				string,
				[number, number]
			>
		)[m[1]!]!;
		return [lo * unit, hi * unit];
	}
	m = /\b(hundreds|thousands|millions|billions)\b/.exec(s);
	if (m && !/\d/.test(s)) {
		const unit = m[1] === 'hundreds' ? 100.0 : MAG[m[1]!]!;
		return [unit, unit * 1000];
	}
	// fractions of a whole, for percentages: "about a third", "over half"
	if (targetKind === 'percent') {
		for (const [phrase, val] of FRACTIONS) {
			if (new RegExp(String.raw`\b${phrase}\b`).test(s)) return qualified(s, val);
		}
		if (/\bmajority\b/.test(s)) return [50.0, 100.0];
	}
	const nums = parseNumbers(s);
	// "between 10 and 20%", "10-20%", "$1-2M"
	if (nums.length === 2 && /\d\S*\s*(?:-|to|and)\s*[$€£¥]?\d/.test(s)) {
		const [a, b] = nums as [Value, Value];
		const multB = Number(b.digits) ? Math.abs(b.value) / Number(b.digits) : 1.0;
		let av = Math.abs(a.value);
		// "$1-2M": the first takes the second's magnitude
		if (av === Number(a.digits) && multB !== 1.0) av *= multB;
		const bv = Math.abs(b.value);
		return [Math.min(av, bv), Math.max(av, bv)];
	}
	if (nums.length === 1) return qualified(s, Math.abs(nums[0]!.value));
	return undefined;
}

/** The interval for one number with its qualifier ("over 20%", "about $4M", "nearly 1,000"). */
function qualified(s: string, val: number): [number, number] {
	const t = ABOUT_TOLERANCE;
	if (/\b(?:just over|a little over|slightly over|slightly above)\b/.test(s)) return [val, val * (1 + t / 2)];
	if (/\b(?:nearly|almost|just under|close to|approaching|shy of)\b/.test(s)) return [val * (1 - t / 2), val];
	if (new RegExp(String.raw`\b${ABOVE}\b`).test(s) || /(?:^|\s)>|\d\+/.test(s)) return [val, Infinity];
	if (new RegExp(String.raw`\b${BELOW}`).test(s) || /(?:^|\s)</.test(s)) return [-Infinity, val];
	// "about", "roughly", or a bare number: a rounded value
	return [val * (1 - t), val * (1 + t)];
}

/** true/false if the rewrite's claim can be checked against the value, else undefined. */
export function isTrue(rewrite: string, original: Value): boolean | undefined {
	const r = claimedRange(rewrite, original);
	if (r === undefined) return undefined;
	const v = Math.abs(original.value);
	const [lo, hi] = r;
	const eps = 1e-9 * Math.max(1.0, v);
	return lo - eps <= v && v <= hi + eps;
}

// --- leak checks ---

/**
 * The rewrite repeats the value: the span text, the number's digits (2+ significant digits), or
 * the same value written another way at the original's precision ("4.2 million" for "$4.2M",
 * "about 70%" for "70%"). A rounder number ("about 13,000" for 12,946) is not a leak but may be
 * `tooPrecise`.
 */
export function leaksValue(rewrite: string, original: Value, spanText: string): boolean {
	const low = rewrite.toLowerCase();
	if (low.includes(spanText.trim().toLowerCase())) return true;
	for (const n of parseNumbers(rewrite)) {
		if (n.digits === original.digits && original.sig >= 2) return true;
		const same =
			original.value !== 0 && Math.abs(Math.abs(n.value) - Math.abs(original.value)) <= 0.005 * Math.abs(original.value);
		if (same && n.sig >= original.sig) return true;
	}
	return false;
}

/**
 * The rewrite gives a number with 2+ significant digits within 5% of the value (e.g. "about
 * 13,000" for 12,946). Vague enough = one significant digit, or words.
 */
export function tooPrecise(rewrite: string, original: Value): boolean {
	return parseNumbers(rewrite).some(
		(n) =>
			n.sig >= 2 &&
			original.value !== 0 &&
			Math.abs(Math.abs(n.value) - Math.abs(original.value)) <= 0.05 * Math.abs(original.value)
	);
}

// --- the deterministic rewrite ---

const DECADE_WORDS: Record<number, string> = Object.fromEntries(Object.entries(DECADES).map(([k, v]) => [v, k]));

function fmtMoney(v: number, cur: string): string {
	for (const [mag, suffix] of [
		[1e9, 'B'],
		[1e6, 'M'],
		[1e3, 'k']
	] as const) {
		if (v >= mag) return `${cur}${pyG(v / mag)}${suffix}`;
	}
	return `${cur}${pyG(v)}`;
}

/**
 * A one-significant-digit bound that is true for v: ["over", 1e6] for 1.47M; for a value that
 * already has one significant digit (2M), ["under", 3M], so the value isn't repeated.
 */
function bound(v: number): ['over' | 'under', number] {
	const m = 10 ** Math.floor(Math.log10(v));
	const lead = v / m;
	if (Math.abs(lead - Math.round(lead)) < 1e-9) return ['under', (Math.round(lead) + 1) * m];
	return ['over', Math.floor(lead) * m];
}

/**
 * Deterministic generalize, true by construction and never repeating the value:
 * - percentages: "under 1%", "single digits", "low/mid/high <decade>" (18% → "high teens"),
 *   "over 100%"
 * - money, counts, durations: a one-significant-digit bound ("$4.2M" → "over $4M",
 *   "12,946" → "over 10,000", "$2M" → "under $3M")
 *
 * Undefined unless the whole span is one number with its currency, magnitude and unit, so names,
 * dates ("March 3, 2026") and mixed text are left to the caller.
 */
export function ruleRewrite(spanText: string): string | undefined {
	const m = NUM_FULL.exec(spanText.trim());
	if (!m?.groups) return undefined;
	const val = toValue(m.groups);
	const v = Math.abs(val.value);
	if (val.kind === 'percent') {
		const sign = val.value < 0 ? 'down ' : '';
		if (v < 1) return `${sign}under 1%`;
		if (v < 10) return `${sign}single digits`;
		if (v >= 100) return `${sign}over 100%`;
		const base = Math.floor(v / 10) * 10;
		const d = v - base;
		const word = d < 3.5 ? 'low' : d < 6.5 ? 'mid' : 'high';
		return `${sign}${word} ${DECADE_WORDS[base]}`;
	}
	if (v === 0) return 'zero';
	const [word, b] = bound(v);
	if (val.kind === 'money') {
		const cur = [...spanText].find((c) => CURRENCY.includes(c)) ?? '$';
		return `${word} ${fmtMoney(b, cur)}`;
	}
	if (val.kind === 'duration_ms') return b >= 1000 ? `${word} ${pyG(b / 1000)} s` : `${word} ${pyG(b)} ms`;
	return `${word} ${pyThousands(b)}`;
}

/** Python's `f"{x:g}"`: 6 significant digits, no trailing zeros, exponent below 1e-4 or from 1e6. */
export function pyG(x: number): string {
	if (x === 0) return '0';
	if (!Number.isFinite(x)) return x > 0 ? 'inf' : x < 0 ? '-inf' : 'nan';
	const [mant, expStr] = x.toExponential(5).split('e') as [string, string];
	const exp = Number(expStr);
	const strip = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
	if (exp < -4 || exp >= 6) return `${strip(mant)}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
	return strip(x.toFixed(5 - exp));
}

/** Python's `f"{x:,.0f}"` (round half to even, comma thousands). */
function pyThousands(x: number): string {
	let r = Math.round(x);
	if (Math.abs(x % 1) === 0.5 && r % 2 !== 0) r -= Math.sign(x);
	return r.toLocaleString('en-US', { maximumFractionDigits: 0 });
}
