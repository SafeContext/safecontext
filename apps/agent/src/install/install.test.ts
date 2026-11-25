/** Settings from IT's MDM profile, and `safecontext doctor` (#26). */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { atLeast, formatDoctor, parseVersion, runDoctor, MANAGED_SETTINGS_FILE, type DoctorDeps } from './doctor.ts';
import { bundleDefaults, preferenceFiles, profileToEnv, readPlist, resolveSettings } from './settings.ts';

describe('settings from the MDM profile', () => {
	it('maps profile keys to the agent variables and ignores the rest', () => {
		expect(
			profileToEnv({
				DashboardURL: ' https://dash.example.com ',
				EnrollmentKey: 'sce_x',
				DeviceLabel: 'C02XYZ',
				ModelServerURL: 'https://models.example.com/v1',
				ModelServerKey: 'k',
				LocalModelFallback: false,
				CheckBudgetMs: 6000,
				Unknown: 'x',
				ModelServerModel: 42
			})
		).toEqual({
			SC_DASHBOARD_URL: 'https://dash.example.com',
			SC_ENROLLMENT_KEY: 'sce_x',
			SC_DEVICE_LABEL: 'C02XYZ',
			SC_TIER2_BASE_URL: 'https://models.example.com/v1',
			SC_TIER2_API_KEY: 'k',
			SC_TIER2_FALLBACK: 'off',
			SC_CHECK_BUDGET_MS: '6000'
		});
	});

	it("puts IT's profile above the environment, and the local file below it", () => {
		const { env, source } = resolveSettings({
			managed: [{ DashboardURL: 'https://it.example.com' }, { DeviceLabel: 'user-scope' }],
			local: { DashboardURL: 'https://local.example.com', EnrollmentKey: 'sce_local' },
			env: { SC_DASHBOARD_URL: 'https://env.example.com', SC_DEVICE_LABEL: 'env', SC_AGENT_PORT: '4800' }
		});
		expect(env).toMatchObject({
			SC_DASHBOARD_URL: 'https://it.example.com',
			SC_DEVICE_LABEL: 'user-scope',
			SC_ENROLLMENT_KEY: 'sce_local',
			SC_AGENT_PORT: '4800'
		});
		expect(source).toBe('profile');
		expect(resolveSettings({ managed: [undefined], local: { DashboardURL: 'https://l' }, env: {} }).source).toBe(
			'local'
		);
		expect(resolveSettings({ managed: [], local: undefined, env: {} }).source).toBe('none');
	});

	it("the device profile wins over a user's", () => {
		const { env } = resolveSettings({
			managed: [{ DashboardURL: 'https://device' }, { DashboardURL: 'https://user' }],
			local: undefined,
			env: {}
		});
		expect(env.SC_DASHBOARD_URL).toBe('https://device');
	});

	it('points an installed agent at its bundled files, with tier 2 on this Mac unless a server is set', () => {
		expect(bundleDefaults(undefined, {})).toEqual({});
		expect(bundleDefaults('/App', {})).toEqual({
			SC_TIER1_MODEL_DIR: '/App/models/tier1',
			SC_TIER2_PROMPTS_DIR: '/App/prompts/tier2',
			SC_EXTRACT_BIN: '/App/bin/sc-extract',
			SC_TIER2_MODEL: 'gemma4:e4b-it-q4_K_M'
		});
		expect(bundleDefaults('/App', { SC_TIER2_BASE_URL: 'https://m/v1' })).not.toHaveProperty('SC_TIER2_MODEL');
		const { env } = resolveSettings({
			managed: [],
			local: undefined,
			env: { SC_BUNDLE_DIR: '/App', SC_TIER1_MODEL_DIR: '/mine' }
		});
		expect(env.SC_TIER1_MODEL_DIR).toBe('/mine');
		expect(env.SC_EXTRACT_BIN).toBe('/App/bin/sc-extract');
	});

	it('looks in the device and user profile folders', () => {
		expect(preferenceFiles('jane')).toEqual({
			managed: [
				'/Library/Managed Preferences/com.safecontext.agent.plist',
				'/Library/Managed Preferences/jane/com.safecontext.agent.plist'
			],
			local: '/Library/Preferences/com.safecontext.agent.plist'
		});
	});

	it.runIf(process.platform === 'darwin')('reads a real plist with plutil', () => {
		const dir = mkdtempSync(join(tmpdir(), 'sc-plist-'));
		const path = join(dir, 'com.safecontext.agent.plist');
		writeFileSync(
			path,
			`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>DashboardURL</key><string>https://dash.example.com</string><key>LocalModelFallback</key><true/></dict></plist>`
		);
		expect(readPlist(path)).toEqual({ DashboardURL: 'https://dash.example.com', LocalModelFallback: true });
		expect(readPlist(join(dir, 'missing.plist'))).toBeUndefined();
		writeFileSync(path, 'not a plist');
		expect(readPlist(path)).toBeUndefined();
	});
});

describe('safecontext doctor', () => {
	const healthy = (over: Partial<DoctorDeps> = {}): DoctorDeps => ({
		env: {
			SC_DASHBOARD_URL: 'https://dash.example.com',
			SC_TIER1_MODEL_DIR: '/App/models/tier1',
			SC_EXTRACT_BIN: '/App/bin/sc-extract',
			SC_TIER2_MODEL: 'gemma4:e4b-it-q4_K_M'
		},
		source: 'profile',
		fetch: (async (url: string) => {
			if (String(url).endsWith('/health')) return Response.json({ ok: true, policyVersion: 7 });
			if (String(url).endsWith('/api/tags')) return Response.json({ models: [{ name: 'gemma4:e4b-it-q4_K_M' }] });
			return Response.json({ data: [] });
		}) as typeof fetch,
		run: async (file) => (file === 'claude' ? '2.1.302 (Claude Code)' : ''),
		exists: () => true,
		readText: (path) => (path === MANAGED_SETTINGS_FILE ? '{"url":"http://127.0.0.1:4747/v1/prompt"}' : undefined),
		uid: 501,
		home: '/Users/jane',
		...over
	});

	it('passes when everything is in place', async () => {
		const checks = await runDoctor(healthy());
		expect(checks.filter((c) => c.status !== 'ok')).toEqual([]);
		expect(checks.find((c) => c.name === 'Agent')?.detail).toContain('policy version 7');
		expect(formatDoctor(checks)).toContain('Everything Safe Context needs is in place.');
	});

	it('says how to fix what is wrong', async () => {
		const checks = await runDoctor(
			healthy({
				fetch: (async () => {
					throw new Error('down');
				}) as typeof fetch,
				run: async (file) => (file === 'claude' ? '2.1.200 (Claude Code)' : undefined),
				exists: () => false,
				readText: () => undefined
			})
		);
		const byName = Object.fromEntries(checks.map((c) => [c.name, c]));
		expect(byName['Agent']).toMatchObject({ status: 'fail', fix: expect.stringContaining('launchctl kickstart') });
		expect(byName['Tier 1 model']?.status).toBe('fail');
		expect(byName['Claude Code']).toMatchObject({ status: 'fail', fix: 'claude update' });
		expect(byName['Claude Code hooks']?.status).toBe('fail');
		expect(byName['Starts at login']?.status).toBe('warn');
		expect(byName['Tier 2 model']?.status).toBe('warn'); // Ollama is optional
		expect(formatDoctor(checks)).toMatch(/4 problems to fix\.$/);
	});

	it("checks the company's model server with its key, and never prints the key", async () => {
		const seen: Array<Record<string, string>> = [];
		const deps = healthy({
			env: {
				...healthy().env,
				SC_TIER2_BASE_URL: 'https://models.example.com/v1',
				SC_TIER2_API_KEY: 'secret-key-123',
				SC_TIER2_MODEL: 'company'
			},
			fetch: (async (url: string, init?: RequestInit) => {
				if (String(url).startsWith('https://models')) {
					seen.push(init?.headers as Record<string, string>);
					return new Response('', { status: 401 });
				}
				return healthy().fetch(url, init);
			}) as typeof fetch
		});
		const checks = await runDoctor(deps);
		expect(seen[0]).toEqual({ authorization: 'Bearer secret-key-123' });
		expect(checks.find((c) => c.name === 'Model server')).toMatchObject({
			status: 'fail',
			detail: expect.stringContaining('refused the key')
		});
		expect(checks.find((c) => c.name === 'Local model (fallback)')?.status).toBe('ok');
		expect(JSON.stringify(checks)).not.toContain('secret-key-123');
	});

	it('accepts the plugin instead of managed settings', async () => {
		const plugin = (text: string, path: string) => (p: string) => (p === path ? text : undefined);
		const on = await runDoctor(
			healthy({
				readText: plugin('{"enabledPlugins":{"safe-context@safecontext": true}}', '/Users/jane/.claude/settings.json')
			})
		);
		expect(on.find((c) => c.name === 'Claude Code hooks')?.status).toBe('ok');
		const installed = await runDoctor(
			healthy({
				readText: plugin(
					'{"plugins":{"safe-context@safecontext":[]}}',
					'/Users/jane/.claude/plugins/installed_plugins.json'
				)
			})
		);
		expect(installed.find((c) => c.name === 'Claude Code hooks')?.status).toBe('warn');
	});

	it('compares versions', () => {
		expect(parseVersion('2.1.299 (Claude Code)')).toEqual([2, 1, 299]);
		expect(atLeast([2, 1, 299], '2.1.299')).toBe(true);
		expect(atLeast([2, 2, 0], '2.1.299')).toBe(true);
		expect(atLeast([2, 1, 298], '2.1.299')).toBe(false);
	});
});
