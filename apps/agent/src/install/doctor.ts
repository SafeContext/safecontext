/**
 * `safecontext doctor` (issue #26): is everything this Mac needs in place, and if not, how to fix
 * it. Reads only settings, file presence and versions; never prompt or tool text, and never
 * prints a key.
 */
import { AGENT_DEFAULT_PORT } from '@safecontext/policy';
import type { SettingsSource } from './settings.ts';

export const MIN_CLAUDE_CODE = '2.1.299';
export const LAUNCH_LABELS = ['com.safecontext.agent', 'homebrew.mxcl.safecontext'];
export const MANAGED_SETTINGS_FILE = '/Library/Application Support/ClaudeCode/managed-settings.json';

export interface DoctorCheck {
	name: string;
	/** `warn`: works, but not as well as it could. */
	status: 'ok' | 'warn' | 'fail';
	detail: string;
	fix?: string;
}

export interface DoctorDeps {
	env: NodeJS.ProcessEnv;
	source: SettingsSource;
	fetch: typeof fetch;
	/** Runs a program; undefined if it can't be run or exits non-zero. */
	run(file: string, args: string[]): Promise<string | undefined>;
	exists(path: string): boolean;
	readText(path: string): string | undefined;
	uid: number;
	home: string;
}

const ok = (name: string, detail: string): DoctorCheck => ({ name, status: 'ok', detail });
const warn = (name: string, detail: string, fix?: string): DoctorCheck => ({
	name,
	status: 'warn',
	detail,
	...(fix && { fix })
});
const fail = (name: string, detail: string, fix: string): DoctorCheck => ({ name, status: 'fail', detail, fix });

async function getJson(deps: DoctorDeps, url: string, headers: Record<string, string> = {}): Promise<unknown> {
	try {
		const res = await deps.fetch(url, { headers, signal: AbortSignal.timeout(3_000) });
		return res.ok ? await res.json() : { httpStatus: res.status };
	} catch {
		return undefined;
	}
}

/** `2.1.299 (Claude Code)` → [2, 1, 299]. */
export function parseVersion(text: string | undefined): number[] | undefined {
	const m = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? '');
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function atLeast(version: number[], min: string): boolean {
	const want = parseVersion(min)!;
	for (let i = 0; i < 3; i++) if (version[i] !== want[i]) return version[i]! > want[i]!;
	return true;
}

export async function runDoctor(deps: DoctorDeps): Promise<DoctorCheck[]> {
	const { env } = deps;
	const port = Number(env.SC_AGENT_PORT) || AGENT_DEFAULT_PORT;
	const checks: DoctorCheck[] = [];
	const restart = `launchctl kickstart -k gui/${deps.uid}/com.safecontext.agent (or: brew services restart safecontext)`;

	const health = (await getJson(deps, `http://127.0.0.1:${port}/health`)) as
		{ ok?: boolean; policyVersion?: number } | undefined;
	checks.push(
		health?.ok === true
			? ok('Agent', `running on 127.0.0.1:${port}, policy version ${health.policyVersion}`)
			: fail('Agent', `nothing answered on 127.0.0.1:${port}`, restart)
	);

	let loaded = false;
	for (const label of LAUNCH_LABELS) {
		if ((await deps.run('/bin/launchctl', ['print', `gui/${deps.uid}/${label}`])) !== undefined) loaded = true;
	}
	checks.push(
		loaded
			? ok('Starts at login', 'the agent runs in the background and restarts if it stops')
			: warn(
					'Starts at login',
					'no background service found',
					'Install the Safe Context package, or: brew services start safecontext'
				)
	);

	if (env.SC_DASHBOARD_URL) {
		const from =
			deps.source === 'profile'
				? "your IT team's profile"
				: deps.source === 'local'
					? 'the local preferences file'
					: 'environment variables';
		checks.push(ok('Dashboard', `${new URL(env.SC_DASHBOARD_URL).origin}, set by ${from}`));
	} else {
		checks.push(
			warn(
				'Dashboard',
				'not connected: the built-in policy applies and nothing is reported',
				'Ask IT for the Safe Context profile (it sets the dashboard address and enrollment key)'
			)
		);
	}

	const modelDir = env.SC_TIER1_MODEL_DIR;
	if (!modelDir) checks.push(warn('Tier 1 model', 'off', 'Reinstall Safe Context: the package includes it'));
	else if (deps.exists(`${modelDir}/model.onnx`)) checks.push(ok('Tier 1 model', 'installed'));
	else checks.push(fail('Tier 1 model', `missing from ${modelDir}`, 'Reinstall Safe Context'));

	const extract = env.SC_EXTRACT_BIN;
	checks.push(
		extract && deps.exists(extract)
			? ok('Images and PDFs', 'text is read on this Mac before Claude sees the file')
			: warn('Images and PDFs', "can't be checked, so the policy's fail mode applies to them", 'Reinstall Safe Context')
	);

	const base = env.SC_TIER2_BASE_URL;
	if (base && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(base)) {
		const key = env.SC_TIER2_API_KEY;
		const models = await getJson(
			deps,
			`${base.replace(/\/+$/, '')}/models`,
			key ? { authorization: `Bearer ${key}` } : {}
		);
		const status = (models as { httpStatus?: number } | undefined)?.httpStatus;
		checks.push(
			models !== undefined && status === undefined
				? ok('Model server', `${new URL(base).host} answers`)
				: fail(
						'Model server',
						status === 401 || status === 403
							? `${new URL(base).host} refused the key`
							: `${new URL(base).host} didn't answer`,
						'Check the model server address and key in the profile, or ask IT'
					)
		);
	}
	const fallbackOff = env.SC_TIER2_FALLBACK === 'off' && base;
	if (!fallbackOff) {
		const want = (base ? env.SC_TIER2_FALLBACK_MODEL : env.SC_TIER2_MODEL) || 'gemma4:e4b-it-q4_K_M';
		const tags = (await getJson(deps, 'http://127.0.0.1:11434/api/tags')) as
			{ models?: Array<{ name?: string }> } | undefined;
		const name = base ? 'Local model (fallback)' : 'Tier 2 model';
		if (!tags?.models) {
			checks.push(
				warn(name, 'Ollama is not running on this Mac', `Optional: install Ollama, then: ollama pull ${want}`)
			);
		} else if (tags.models.some((m) => m.name === want || m.name === `${want}:latest`)) {
			checks.push(ok(name, `${want} is ready in Ollama`));
		} else {
			checks.push(warn(name, `${want} isn't in Ollama`, `ollama pull ${want}`));
		}
	}

	const claude = parseVersion(await deps.run('claude', ['--version']));
	if (!claude) checks.push(warn('Claude Code', 'not found on PATH'));
	else if (atLeast(claude, MIN_CLAUDE_CODE)) checks.push(ok('Claude Code', `version ${claude.join('.')}`));
	else
		checks.push(
			fail('Claude Code', `version ${claude.join('.')} is too old (needs ${MIN_CLAUDE_CODE})`, 'claude update')
		);

	const managed = deps.readText(MANAGED_SETTINGS_FILE);
	const user = deps.readText(`${deps.home}/.claude/settings.json`);
	const installed = deps.readText(`${deps.home}/.claude/plugins/installed_plugins.json`);
	if (managed?.includes(`127.0.0.1:${port}`)) {
		checks.push(ok('Claude Code hooks', "your organisation's managed settings send every check to the agent"));
	} else if (user && /"safe-context@[^"]*"\s*:\s*true/.test(user)) {
		checks.push(ok('Claude Code hooks', 'the Safe Context plugin is on for every project'));
	} else if (installed?.includes('"safe-context@')) {
		checks.push(
			warn(
				'Claude Code hooks',
				'the Safe Context plugin is installed; it only checks projects where it is turned on',
				'Turn it on everywhere: /plugin, then enable safe-context for your user'
			)
		);
	} else {
		checks.push(
			fail(
				'Claude Code hooks',
				"Claude Code isn't set up to ask the agent",
				"Ask IT to deploy the managed settings from the dashboard's Deploy page, or install the Safe Context plugin"
			)
		);
	}
	return checks;
}

export function formatDoctor(checks: DoctorCheck[]): string {
	const mark = { ok: '✓', warn: '!', fail: '✗' } as const;
	const width = Math.max(...checks.map((c) => c.name.length));
	const lines = checks.flatMap((c) => [
		`${mark[c.status]} ${c.name.padEnd(width)}  ${c.detail}`,
		...(c.fix && c.status !== 'ok' ? [`  ${' '.repeat(width)}  Fix: ${c.fix}`] : [])
	]);
	const failed = checks.filter((c) => c.status === 'fail').length;
	lines.push(
		'',
		failed ? `${failed} problem${failed === 1 ? '' : 's'} to fix.` : 'Everything Safe Context needs is in place.'
	);
	return lines.join('\n');
}
