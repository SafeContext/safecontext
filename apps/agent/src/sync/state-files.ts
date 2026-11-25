/**
 * Files the agent keeps in its state folder (`SC_STATE_DIR`): the last policy pulled from the
 * dashboard, and from before #51 the device id. Neither is a secret, but the policy holds the
 * admin's term lists, so files are private to the user (0600, folder 0700).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Id, Policy } from '@safecontext/policy';

/** Before #51 agents chose their own device id and kept it here. Read, never written. */
export const DEVICE_ID_FILE = 'device-id';
export const POLICY_CACHE_FILE = 'policy-cache.json';

/** Write `content` to `path` atomically (temp file + rename), private to the user. */
export function writePrivateFile(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
	writeFileSync(tmp, content, { mode: 0o600 });
	renameSync(tmp, path);
}

/**
 * The device id a pre-#51 agent saved in `stateDir`, which its Keychain token belongs to.
 * Undefined if there is none or it can't be read. Never throws.
 */
export function readLegacyDeviceId(stateDir: string): string | undefined {
	try {
		const id = readFileSync(join(stateDir, DEVICE_ID_FILE), 'utf8').trim();
		return Id.safeParse(id).success ? id : undefined;
	} catch {
		return undefined;
	}
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
