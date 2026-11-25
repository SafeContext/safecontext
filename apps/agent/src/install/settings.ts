/**
 * Settings for an installed agent (issue #26). IT sets them with an MDM configuration profile
 * (preference domain `com.safecontext.agent`); a Mac without MDM can use the same keys in
 * `/Library/Preferences/com.safecontext.agent.plist`. They become the agent's `SC_*` variables:
 *
 *     managed profile  >  environment  >  local preferences file  >  installed defaults
 *
 * so IT's profile always wins, and developers can still set variables when there's no profile.
 * The installed defaults point at the files the installer put in `SC_BUNDLE_DIR`.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { AGENT_PREFERENCE_DOMAIN, AGENT_PROFILE_KEYS } from '@safecontext/policy';
import { PINNED_TIER2_MODEL } from '../config.ts';

export const PREFERENCE_DOMAIN = AGENT_PREFERENCE_DOMAIN;
/** Profile key → variable (packages/policy, shared with the dashboard's profile download). */
export const PROFILE_KEYS = AGENT_PROFILE_KEYS;

export type ProfileKey = keyof typeof PROFILE_KEYS;

/** The variables a profile's keys stand for. Unknown keys and values of the wrong kind are ignored. */
export function profileToEnv(profile: Record<string, unknown>): Record<string, string> {
	const env: Record<string, string> = {};
	for (const [key, name] of Object.entries(PROFILE_KEYS)) {
		const v = profile[key];
		if (key === 'LocalModelFallback') {
			if (typeof v === 'boolean') env[name] = v ? 'local' : 'off';
		} else if (key === 'CheckBudgetMs') {
			if (typeof v === 'number' && Number.isInteger(v)) env[name] = String(v);
		} else if (typeof v === 'string' && v.trim()) {
			env[name] = v.trim();
		}
	}
	return env;
}

/** Where the profile and the local file are, most important first (device, then user scope). */
export function preferenceFiles(user = safeUser()): { managed: string[]; local: string } {
	return {
		managed: [
			`/Library/Managed Preferences/${PREFERENCE_DOMAIN}.plist`,
			...(user ? [`/Library/Managed Preferences/${user}/${PREFERENCE_DOMAIN}.plist`] : [])
		],
		local: `/Library/Preferences/${PREFERENCE_DOMAIN}.plist`
	};
}

/** A plist as JSON, via macOS's own `plutil`. Undefined if it's missing or unreadable. */
export function readPlist(path: string): Record<string, unknown> | undefined {
	if (!existsSync(path)) return undefined;
	try {
		const json = execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], {
			encoding: 'utf8',
			timeout: 5_000,
			stdio: ['ignore', 'pipe', 'ignore']
		});
		const parsed: unknown = JSON.parse(json);
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
			? (parsed as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

/** Defaults for an installed agent: the bundled model, prompts and helper, and tier 2 on this Mac. */
export function bundleDefaults(bundleDir: string | undefined, env: NodeJS.ProcessEnv): Record<string, string> {
	if (!bundleDir) return {};
	const defaults: Record<string, string> = {
		SC_TIER1_MODEL_DIR: join(bundleDir, 'models', 'tier1'),
		SC_TIER2_PROMPTS_DIR: join(bundleDir, 'prompts', 'tier2'),
		SC_EXTRACT_BIN: join(bundleDir, 'bin', 'sc-extract')
	};
	// Tier 2 is on: the company's server when the profile names one, else Ollama on this Mac if
	// it's there (#75). Without either its calls fail fast and its spans stay flagged.
	if (!env.SC_TIER2_BASE_URL && !env.SC_TIER2_MODEL) defaults.SC_TIER2_MODEL = PINNED_TIER2_MODEL;
	return defaults;
}

export interface SettingsSources {
	managed: Array<Record<string, unknown> | undefined>;
	local: Record<string, unknown> | undefined;
	env: NodeJS.ProcessEnv;
}

export type SettingsSource = 'profile' | 'local' | 'none';

/** The agent's variables from every source, in order, and where the dashboard setting came from. */
export function resolveSettings({ managed, local, env }: SettingsSources): {
	env: NodeJS.ProcessEnv;
	source: SettingsSource;
} {
	const fromManaged = Object.assign({}, ...[...managed].reverse().map((p) => (p ? profileToEnv(p) : {})));
	const fromLocal = local ? profileToEnv(local) : {};
	const merged = { ...fromLocal, ...env, ...fromManaged };
	const withDefaults = { ...bundleDefaults(merged.SC_BUNDLE_DIR, merged), ...merged };
	const source: SettingsSource = managed.some((p) => p && Object.keys(profileToEnv(p)).length)
		? 'profile'
		: Object.keys(fromLocal).length
			? 'local'
			: 'none';
	return { env: withDefaults, source };
}

/** The settings this Mac has right now. Only reads files on macOS. */
export function loadSettings(env: NodeJS.ProcessEnv = process.env): {
	env: NodeJS.ProcessEnv;
	source: SettingsSource;
} {
	if (process.platform !== 'darwin') return resolveSettings({ managed: [], local: undefined, env });
	const files = preferenceFiles();
	return resolveSettings({ managed: files.managed.map(readPlist), local: readPlist(files.local), env });
}

function safeUser(): string | undefined {
	try {
		const name = userInfo().username;
		return /^[A-Za-z0-9._-]+$/.test(name) ? name : undefined;
	} catch {
		return undefined;
	}
}
