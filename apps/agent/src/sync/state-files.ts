/**
 * Files the agent keeps in its state folder (`SC_STATE_DIR`): the anonymised device id and the
 * last policy pulled from the dashboard. Neither is a secret, but the policy holds the admin's
 * term lists, so files are private to the user (0600, folder 0700).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Id, Policy } from '@safecontext/policy';

export const DEVICE_ID_FILE = 'device-id';
export const POLICY_CACHE_FILE = 'policy-cache.json';

/** Write `content` to `path` atomically (temp file + rename), private to the user. */
export function writePrivateFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
	writeFileSync(tmp, content, { mode: 0o600 });
	renameSync(tmp, path);
}

/** A new anonymised device id: random, so it says nothing about the machine or the user. */
export function newDeviceId(): string {
	return `dev-${randomBytes(16).toString('hex')}`;
}

/** The device id stored in `stateDir`, creating it on first run. */
export function loadOrCreateDeviceId(stateDir: string): string {
	const path = join(stateDir, DEVICE_ID_FILE);
	try {
		const existing = readFileSync(path, 'utf8').trim();
		if (Id.safeParse(existing).success) return existing;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
	}
	const id = newDeviceId();
	writePrivateFile(path, id + '\n');
	return id;
}

export interface PolicyCache {
	/** The `ETag` header the dashboard sent with this policy, as is. */
	etag?: string;
	policy: Policy;
}

export type PolicyCacheResult =
	| { ok: true; cache: PolicyCache }
	| { ok: false; error: 'missing' | 'unreadable' | 'not_json' | 'invalid'; issues?: number };

/** Read and validate the policy cache. Never throws. */
export function readPolicyCache(path: string): PolicyCacheResult {
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (err) {
		return { ok: false, error: (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'unreadable' };
	}
	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { ok: false, error: 'not_json' };
	}
	if (typeof json !== 'object' || json === null) return { ok: false, error: 'invalid' };
	const { etag, policy } = json as { etag?: unknown; policy?: unknown };
	if (etag !== undefined && (typeof etag !== 'string' || etag === '' || etag.length > 256)) {
		return { ok: false, error: 'invalid' };
	}
	const parsed = Policy.safeParse(policy);
	if (!parsed.success) return { ok: false, error: 'invalid', issues: parsed.error.issues.length };
	return { ok: true, cache: { ...(etag !== undefined && { etag }), policy: parsed.data } };
}

export function writePolicyCache(path: string, cache: PolicyCache): void {
	writePrivateFile(path, JSON.stringify(cache));
}
