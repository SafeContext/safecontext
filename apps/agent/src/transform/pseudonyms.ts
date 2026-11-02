/**
 * `pseudonymize`: a placeholder per value that stays the same within a Claude Code session
 * ("Northwind" → "customer_name_1" every time), so Claude can still tell items apart (SPEC.md §4).
 *
 * Memory only, never logged, never written to disk. Bounded three ways: number of sessions
 * (least recently used dropped first), entries per session (oldest dropped first) and idle time.
 * Values are stored as a keyed hash (HMAC with a random per-process key), not as text, so the
 * map itself holds no flagged text. Numbers are never reused within a session, so a dropped
 * entry seen again gets a new number rather than another value's.
 */
import { createHmac, randomBytes } from 'node:crypto';

export interface PseudonymStoreOptions {
	/** Sessions kept at once. Default 256. */
	maxSessions?: number;
	/** Values remembered per session. Default 4096. */
	maxPerSession?: number;
	/** A session unused for this long is forgotten. Default 12 hours. */
	idleMs?: number;
	/** Clock in ms. Injected for tests. */
	now?: () => number;
}

/** The pseudonyms of one session. */
export interface SessionPseudonyms {
	/** Placeholder for `value`, a span of data type `dataTypeId`. Same input, same answer. */
	get(dataTypeId: string, value: string): string;
}

export interface PseudonymStore {
	session(sessionId: string): SessionPseudonyms;
	/** Sessions currently held. For tests. */
	readonly size: number;
}

interface Session {
	lastUsed: number;
	/** hash(data type, value) → placeholder, oldest first. */
	byValue: Map<string, string>;
	/** Last number used per prefix. */
	counters: Map<string, number>;
}

export function createPseudonymStore({
	maxSessions = 256,
	maxPerSession = 4096,
	idleMs = 12 * 60 * 60 * 1000,
	now = () => Date.now()
}: PseudonymStoreOptions = {}): PseudonymStore {
	const key = randomBytes(32);
	// Ordered by last use, oldest first: delete + set on every access.
	const sessions = new Map<string, Session>();

	const hash = (dataTypeId: string, value: string) =>
		createHmac('sha256', key).update(dataTypeId).update('\0').update(normalize(value)).digest('base64url');

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
			else session = { lastUsed: t, byValue: new Map(), counters: new Map() };
			session.lastUsed = t;
			sessions.set(sessionId, session);
			while (sessions.size > maxSessions) sessions.delete(sessions.keys().next().value!);

			const s = session;
			return {
				get(dataTypeId, value) {
					const h = hash(dataTypeId, value);
					const known = s.byValue.get(h);
					if (known !== undefined) return known;
					const prefix = prefixFor(dataTypeId);
					const n = (s.counters.get(prefix) ?? 0) + 1;
					s.counters.set(prefix, n);
					const placeholder = `${prefix}_${n}`;
					s.byValue.set(h, placeholder);
					if (s.byValue.size > maxPerSession) s.byValue.delete(s.byValue.keys().next().value!);
					return placeholder;
				}
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
