/**
 * Labelled placeholders and the key behind them (SPEC.md §4, issue #83).
 *
 * Every value Safe Context hides from Claude becomes a placeholder such as `⟪customer_name_1⟫`,
 * or `⟪revenue_figure_1: over $4M⟫` when a true hint can be shown. A placeholder says three
 * things: Safe Context hid something, what kind of data it was, and which one (the same value
 * gets the same placeholder throughout a Claude Code session).
 *
 * The key (placeholder ↔ real value) is per Claude Code session and lives only in the agent's
 * memory. It is never logged, sent to the dashboard or written to disk. It is what lets the
 * agent put real values back into local file tools (restore.ts) and hide them again in what
 * those tools return (`SessionKey.entries`). Bounded three ways: sessions kept (least recently
 * used dropped first), values per session (oldest dropped first) and idle time. Numbers are
 * never reused within a session, so a dropped value seen again gets a new number, never
 * another value's.
 */

export const OPEN = '⟪';
export const CLOSE = '⟫';

/**
 * A placeholder in text: `⟪<id>⟫` or `⟪<id>: <hint>⟫`. Group 1 is the id (`customer_name_1`).
 * Claude may drop or change the hint when it copies one, so only the id matters.
 */
export const PLACEHOLDER = /⟪([a-z0-9]+(?:_[a-z0-9]+)*_[1-9][0-9]*)(?::[^⟪⟫\n]{0,100})?⟫/g;

/** A hint as it appears in a placeholder: no bracket or line break, so it can't end the placeholder early. */
export function cleanHint(hint: string | undefined): string {
	return (hint ?? '').replace(/[⟪⟫\r\n]+/g, ' ').trim();
}

/** `⟪id⟫`, or `⟪id: hint⟫`. */
export function formatPlaceholder(id: string, hint?: string): string {
	const clean = cleanHint(hint);
	return clean ? `${OPEN}${id}: ${clean}${CLOSE}` : `${OPEN}${id}${CLOSE}`;
}

/**
 * Every placeholder in `text`, in order: [start, end) of the whole placeholder, and [hintStart,
 * hintEnd) of its hint (empty when it has none).
 */
export function placeholderRanges(
	text: string
): Array<{ start: number; end: number; id: string; hintStart: number; hintEnd: number; hint: string }> {
	if (!text.includes(OPEN)) return [];
	return [...text.matchAll(PLACEHOLDER)].map((m) => {
		const start = m.index;
		const end = start + m[0].length;
		const afterId = start + OPEN.length + m[1]!.length;
		let hintStart = afterId < end - CLOSE.length ? afterId + 1 : afterId; // skip the ":"
		while (hintStart < end - CLOSE.length && text[hintStart] === ' ') hintStart++;
		return {
			start,
			end,
			id: m[1]!,
			hintStart,
			hintEnd: end - CLOSE.length,
			hint: text.slice(hintStart, end - CLOSE.length)
		};
	});
}

export interface PlaceholderStoreOptions {
	/** Sessions kept at once. Default 256. */
	maxSessions?: number;
	/** Values remembered per session. Default 4096. */
	maxPerSession?: number;
	/** A session unused for this long is forgotten. Default 12 hours. */
	idleMs?: number;
	/** Clock in ms. Injected for tests. */
	now?: () => number;
}

export interface KeyEntry {
	/** `customer_name_1` (no brackets). */
	id: string;
	dataTypeId: string;
	/** The real value, as first seen. */
	value: string;
	/**
	 * Every spelling seen for it, first seen first ("Northwind" in a document, "northwind" in a
	 * file name). They share one placeholder, so swap-back picks the one that fits (restore.ts).
	 */
	spellings: string[];
	/** Every hint shown with this placeholder (cleaned, see `cleanHint`). */
	hints: string[];
}

/** Spellings remembered per value. */
export const MAX_SPELLINGS = 8;

/** The key of one Claude Code session. */
export interface SessionKey {
	/** Placeholder id for `value`, a span of data type `dataTypeId`. Same input, same answer. */
	idFor(dataTypeId: string, value: string): string;
	/** The real value behind `id`, or undefined if this session never had it (or forgot it). */
	valueOf(id: string): string | undefined;
	/** Every spelling seen behind `id`, first seen first. Empty if the key doesn't hold it. */
	spellingsOf(id: string): readonly string[];
	/** Records that `id` was shown with `hint`, so that exact placeholder isn't checked again. */
	noteHint(id: string, hint: string): void;
	/** True if this session issued `id`, shown with `hint` (`''` for no hint). */
	issued(id: string, hint: string): boolean;
	/** Every value held, oldest first, so the caller can hide them wherever they come back. */
	entries(): readonly KeyEntry[];
}

export interface PlaceholderStore {
	session(sessionId: string): SessionKey;
	/** Sessions currently held. For tests. */
	readonly size: number;
}

interface Session {
	lastUsed: number;
	/** data type + normalized value → entry, oldest first. */
	byValue: Map<string, KeyEntry>;
	byId: Map<string, KeyEntry>;
	/** Last number used per prefix. */
	counters: Map<string, number>;
}

export function createPlaceholderStore({
	maxSessions = 256,
	maxPerSession = 4096,
	idleMs = 12 * 60 * 60 * 1000,
	now = () => Date.now()
}: PlaceholderStoreOptions = {}): PlaceholderStore {
	// Ordered by last use, oldest first: delete + set on every access.
	const sessions = new Map<string, Session>();

	return {
		get size() {
			return sessions.size;
		},
		session(sessionId) {
			const t = now();
			for (const [id, s] of sessions) {
				if (t - s.lastUsed < idleMs) break;
				sessions.delete(id);
			}
			let session = sessions.get(sessionId);
			if (session) sessions.delete(sessionId);
			else session = { lastUsed: t, byValue: new Map(), byId: new Map(), counters: new Map() };
			session.lastUsed = t;
			sessions.set(sessionId, session);
			while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value!);

			const s = session;
			return {
				idFor(dataTypeId, value) {
					const k = `${dataTypeId}\0${normalize(value)}`;
					const known = s.byValue.get(k);
					if (known !== undefined) {
						if (!known.spellings.includes(value) && known.spellings.length < MAX_SPELLINGS) {
							known.spellings.push(value);
						}
						return known.id;
					}
					const prefix = prefixFor(dataTypeId);
					const n = (s.counters.get(prefix) ?? 0) + 1;
					s.counters.set(prefix, n);
					const entry = { id: `${prefix}_${n}`, dataTypeId, value, spellings: [value], hints: [] as string[] };
					s.byValue.set(k, entry);
					s.byId.set(entry.id, entry);
					if (s.byValue.size > maxPerSession) {
						const [oldKey, old] = s.byValue.entries().next().value!;
						s.byValue.delete(oldKey);
						s.byId.delete(old.id);
					}
					return entry.id;
				},
				valueOf: (id) => s.byId.get(id)?.value,
				spellingsOf: (id) => s.byId.get(id)?.spellings ?? [],
				noteHint(id, hint) {
					const entry = s.byId.get(id);
					const clean = cleanHint(hint);
					if (entry && clean && !entry.hints.includes(clean) && entry.hints.length < MAX_SPELLINGS) {
						entry.hints.push(clean);
					}
				},
				issued(id, hint) {
					const entry = s.byId.get(id);
					const clean = cleanHint(hint);
					return entry !== undefined && (clean === '' || entry.hints.includes(clean));
				},
				entries: () => [...s.byValue.values()]
			};
		}
	};
}

/** "Northwind", " northwind" and "NORTHWIND" are the same customer. */
function normalize(value: string): string {
	return value.normalize('NFKC').trim().toLowerCase();
}

/**
 * Placeholder prefix from the data type id: dashes become underscores and a plural last word
 * loses its "s", except "-ss", "-us", "-is" ("customer-names" → "customer_name", "customer-personal-data" →
 * "customer_personal_data", "secrets" → "secret").
 */
export function prefixFor(dataTypeId: string): string {
	const words = dataTypeId.split('-').filter(Boolean);
	const last = words.at(-1);
	if (last !== undefined && last.length > 3 && /[^siu]s$/.test(last)) {
		words[words.length - 1] = last.slice(0, -1);
	}
	return words.join('_') || 'item';
}

/**
 * Placeholders already in a text aren't flagged again, but only ones this session issued: text in
 * placeholder form can come from a file or web page too (`⟪note_1: jane@example.com⟫`, PR #86 review).
 * - Issued, with the hint it was issued with (or none): the whole placeholder is cut out of spans.
 * - Issued id, any other hint: only `⟪id:` and `⟫` are cut out; the hint text is still checked.
 * - Not issued: ordinary text, nothing is cut out.
 * Whatever is left of a span (text either side, hint text) stays flagged.
 */
export function dropPlaceholderSpans<S extends { start: number; end: number }>(
	text: string,
	spans: readonly S[],
	key: Pick<SessionKey, 'issued' | 'spellingsOf'>
): S[] {
	const prot = placeholderRanges(text).flatMap((r) => {
		if (key.issued(r.id, r.hint)) return [{ start: r.start, end: r.end }];
		if (key.spellingsOf(r.id).length > 0) {
			return [
				{ start: r.start, end: r.hintStart },
				{ start: r.hintEnd, end: r.end }
			];
		}
		return [];
	});
	if (prot.length === 0) return [...spans];
	const out: S[] = [];
	for (const span of spans) {
		let pieces = [{ start: span.start, end: span.end }];
		for (const p of prot) {
			pieces = pieces.flatMap((q) =>
				q.end <= p.start || p.end <= q.start
					? [q]
					: [
							{ start: q.start, end: p.start },
							{ start: p.end, end: q.end }
						].filter((x) => x.end > x.start)
			);
		}
		for (const q of pieces) if (/\S/.test(text.slice(q.start, q.end))) out.push({ ...span, ...q });
	}
	return out;
}
