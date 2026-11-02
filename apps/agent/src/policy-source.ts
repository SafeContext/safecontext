/**
 * Where the agent gets its policy. The hook handlers only see `PolicySource`, so the dashboard
 * sync in issue #22 can replace the file source without touching them.
 */
import { readFileSync } from 'node:fs';
import { defaultPolicy, Policy } from '@safecontext/policy';
import type { Logger } from './log.ts';

export interface PolicySource {
	/**
	 * The policy to enforce right now. Called on every hook request, so it must be fast
	 * (return a cached value) and must never throw.
	 */
	current(): Policy;
	/**
	 * Where `current()` came from, for logs and /health. `dashboard` and `cache` come from
	 * dashboard sync (sync/policy-sync.ts).
	 */
	readonly kind: 'file' | 'default' | 'static' | 'dashboard' | 'cache';
	/** Stop any timers or watchers. */
	close?(): void | Promise<void>;
}

/** A fixed policy. For tests, and as the base for other sources. */
export function staticPolicySource(policy: Policy, kind: PolicySource['kind'] = 'static'): PolicySource {
	return { kind, current: () => policy };
}

export type PolicyFileResult =
	| { ok: true; policy: Policy }
	| { ok: false; error: 'missing' | 'unreadable' | 'not_json' | 'invalid'; issues?: number };

/** Read and validate a policy file. Never throws. */
export function readPolicyFile(path: string): PolicyFileResult {
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
	const parsed = Policy.safeParse(json);
	if (!parsed.success) return { ok: false, error: 'invalid', issues: parsed.error.issues.length };
	return { ok: true, policy: parsed.data };
}

/**
 * Load the policy once from `path` (env `SC_POLICY_FILE`). If there is no path, or the file is
 * missing or invalid, fall back to `defaultPolicy()` and log why (never the file's contents).
 */
export function filePolicySource(
	path: string | undefined,
	logger: Logger,
	now: () => Date = () => new Date()
): PolicySource {
	if (path === undefined) {
		const policy = defaultPolicy(now());
		logger.log('info', 'policy_loaded', { policySource: 'default', policyVersion: policy.version });
		return staticPolicySource(policy, 'default');
	}
	const result = readPolicyFile(path);
	if (!result.ok) {
		const policy = defaultPolicy(now());
		logger.log('warn', 'policy_fallback', {
			policySource: 'default',
			policyVersion: policy.version,
			policyError: result.error,
			...(result.issues !== undefined && { issues: result.issues })
		});
		return staticPolicySource(policy, 'default');
	}
	logger.log('info', 'policy_loaded', { policySource: 'file', policyVersion: result.policy.version });
	return staticPolicySource(result.policy, 'file');
}
