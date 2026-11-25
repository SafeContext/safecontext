/**
 * Keeps each Claude Code session's placeholder key across agent restarts (issue #85).
 *
 * One file per session in `<state dir>/keys/`, encrypted with AES-256-GCM. The encryption key is
 * a random 256-bit key kept in the login Keychain, so the files are unreadable without this
 * user's Keychain. A file name is a hash of the session id. A file not used for `idleMs` (12 hours,
 * like the key in memory) is deleted.
 *
 * Claude Code's own transcript on disk already holds the values Safe Context swapped back in
 * (SPEC.md §2), so this is not the first copy on disk; it is the only encrypted one.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { KeyEntry } from '../transform/placeholders.ts';

/** What is saved for one session: enough to carry on exactly where it left off. */
export interface SessionSnapshot {
	/** ms since the epoch. */
	lastUsed: number;
	/** Last number used per placeholder prefix, so numbers are never reused. */
	counters: Array<[string, number]>;
	/** Oldest first. */
	entries: KeyEntry[];
}

export interface KeyVault {
	/** The saved key, or undefined if there is none, it is too old, or it can't be read. Never throws. */
	load(sessionId: string): SessionSnapshot | undefined;
	/** Save (replace) the key. Never throws; a failure is logged by the caller's `onError`. */
	save(sessionId: string, snapshot: SessionSnapshot): void;
	/** Delete keys unused for `idleMs`. Returns how many were deleted. Never throws. */
	sweep(): number;
}

export interface FileVaultOptions {
	/** Folder for the key files (created 0700). */
	dir: string;
	/** 32-byte encryption key. */
	key: Buffer;
	idleMs?: number;
	now?: () => number;
	/** Called with a fixed code when something fails. Never with key material or values. */
	onError?: (code: 'vault_read_failed' | 'vault_write_failed') => void;
}

const VERSION = 1;
const IV_BYTES = 12;
const TAG_BYTES = 16;
export const KEY_BYTES = 32;
const SUFFIX = '.key';

/** The file name for a session: a hash, so session ids never appear on disk. */
export function vaultFileName(sessionId: string): string {
	return createHash('sha256').update(`safecontext-session:${sessionId}`).digest('hex').slice(0, 40) + SUFFIX;
}

export function encrypt(key: Buffer, plaintext: Buffer, aad: string): Buffer {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	cipher.setAAD(Buffer.from(aad));
	const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
	return Buffer.concat([Buffer.of(VERSION), iv, cipher.getAuthTag(), body]);
}

/** Throws if the data was changed, moved from another file, or made with another key. */
export function decrypt(key: Buffer, data: Buffer, aad: string): Buffer {
	if (data.length < 1 + IV_BYTES + TAG_BYTES || data[0] !== VERSION) throw new Error('unknown format');
	const iv = data.subarray(1, 1 + IV_BYTES);
	const tag = data.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
	const decipher = createDecipheriv('aes-256-gcm', key, iv);
	decipher.setAAD(Buffer.from(aad));
	decipher.setAuthTag(tag);
	return Buffer.concat([decipher.update(data.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export function createFileVault({
	dir,
	key,
	idleMs = 12 * 60 * 60 * 1000,
	now = () => Date.now(),
	onError = () => {}
}: FileVaultOptions): KeyVault {
	if (key.length !== KEY_BYTES) throw new Error('The vault key must be 32 bytes');
	mkdirSync(dir, { recursive: true, mode: 0o700 });

	const remove = (path: string) => rmSync(path, { force: true });

	return {
		load(sessionId) {
			const name = vaultFileName(sessionId);
			const path = join(dir, name);
			let data: Buffer;
			try {
				data = readFileSync(path);
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== 'ENOENT') onError('vault_read_failed');
				return undefined;
			}
			try {
				const snapshot = parseSnapshot(JSON.parse(decrypt(key, data, name).toString('utf8')));
				if (now() - snapshot.lastUsed >= idleMs) {
					remove(path);
					return undefined;
				}
				return snapshot;
			} catch {
				// Unreadable (another Keychain key, damaged): useless, so it goes.
				onError('vault_read_failed');
				remove(path);
				return undefined;
			}
		},
		save(sessionId, snapshot) {
			const name = vaultFileName(sessionId);
			const path = join(dir, name);
			try {
				const data = encrypt(key, Buffer.from(JSON.stringify(snapshot)), name);
				const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
				writeFileSync(tmp, data, { mode: 0o600 });
				renameSync(tmp, path);
			} catch {
				onError('vault_write_failed');
			}
		},
		sweep() {
			let deleted = 0;
			let names: string[];
			try {
				names = readdirSync(dir);
			} catch {
				return 0;
			}
			for (const name of names) {
				const path = join(dir, name);
				try {
					// The file's time is when it was last saved, i.e. last changed. Leftover temp files go too.
					if (name.endsWith('.tmp') || now() - statSync(path).mtimeMs >= idleMs) {
						remove(path);
						deleted++;
					}
				} catch {
					// Gone already.
				}
			}
			return deleted;
		}
	};
}

function parseSnapshot(raw: unknown): SessionSnapshot {
	const s = raw as Partial<SessionSnapshot> | null;
	if (
		!s ||
		typeof s.lastUsed !== 'number' ||
		!Array.isArray(s.counters) ||
		!Array.isArray(s.entries) ||
		!s.counters.every((c) => Array.isArray(c) && typeof c[0] === 'string' && typeof c[1] === 'number') ||
		!s.entries.every(
			(e) =>
				typeof e?.id === 'string' &&
				typeof e.dataTypeId === 'string' &&
				typeof e.value === 'string' &&
				Array.isArray(e.spellings) &&
				Array.isArray(e.hints)
		)
	) {
		throw new Error('bad snapshot');
	}
	return s as SessionSnapshot;
}
