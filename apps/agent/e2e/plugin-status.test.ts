/**
 * The plugin's health check script (`plugin/scripts/agent-status.sh`), run with `sh` against a
 * real agent on an ephemeral port. Used by the SessionStart hook and the /safe-context:status
 * skill. No Claude Code here, so this runs in the default `pnpm test`.
 */
import { execFile } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { AGENT_API, AGENT_DEFAULT_PORT, AGENT_HOST } from '@safecontext/policy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.ts';
import { createClassifier } from '../src/classifier/classifier.ts';
import { createTier0 } from '../src/classifier/tier0.ts';
import { staticPolicySource } from '../src/policy-source.ts';
import { startServer, type RunningServer } from '../src/server.ts';
import { policyWith } from '../src/test-helpers.ts';
import { freePort, pluginDir } from './helpers.ts';

const script = join(pluginDir, 'scripts/agent-status.sh');
const run = promisify(execFile);

async function status(port: number | string, ...args: string[]) {
	return statusAt(script, port, ...args);
}

async function statusAt(scriptPath: string, port: number | string, ...args: string[]) {
	const { stdout } = await run('sh', [scriptPath, ...args], { env: { ...process.env, SC_AGENT_PORT: String(port) } });
	return stdout;
}

let agent: RunningServer;
let notAgent: Server;
let notAgentPort: number;
let unhealthy: Server;
let healthOnly: Server;
let healthOnlyPort: number;
let unhealthyPort: number;
beforeAll(async () => {
	const app = createApp({
		policy: staticPolicySource(policyWith({ version: 7 })),
		classifier: createClassifier({ tiers: [createTier0()], budgetMs: 1_000 })
	});
	agent = await startServer(app, 0);
	// Something else on the port: answers 200, but not with the agent's health JSON.
	notAgent = createServer((_req, res) => res.end('<html>hello</html>'));
	await new Promise<void>((resolve) => notAgent.listen(0, AGENT_HOST, resolve));
	notAgentPort = (notAgent.address() as AddressInfo).port;
	// A healthy health check, but no session-start note (e.g. an older agent).
	healthOnly = createServer((req, res) => {
		if (req.url === '/health') res.end('{"ok":true,"policyVersion":7}');
		else res.writeHead(404).end();
	});
	await new Promise<void>((resolve) => healthOnly.listen(0, AGENT_HOST, resolve));
	healthOnlyPort = (healthOnly.address() as AddressInfo).port;
	// The agent's health JSON, but reporting a problem. Today's agent always says ok: true.
	unhealthy = createServer((_req, res) => res.end('{"ok":false,"policyVersion":7}'));
	await new Promise<void>((resolve) => unhealthy.listen(0, AGENT_HOST, resolve));
	unhealthyPort = (unhealthy.address() as AddressInfo).port;
});
afterAll(async () => {
	await agent.close();
	await new Promise((resolve) => notAgent.close(resolve));
	await new Promise((resolve) => unhealthy.close(resolve));
	await new Promise((resolve) => healthOnly.close(resolve));
});

describe('agent-status.sh (/safe-context:status)', () => {
	it('shows the port and policy version when the agent is running', async () => {
		expect(await status(agent.port)).toBe(
			`Safe Context: the agent is running on 127.0.0.1:${agent.port}, enforcing policy version 7.\n`
		);
	});

	it('says how to fix it when nothing is listening', async () => {
		const out = await status(await freePort());
		expect(out).toContain("the agent isn't running");
		expect(out).toContain('How to fix: Start the Safe Context agent');
	});

	it('spots something other than the agent on the port', async () => {
		expect(await status(notAgentPort)).toContain("answered, but it isn't the Safe Context agent");
	});

	it('reports an agent that answers but is unhealthy', async () => {
		const out = await status(unhealthyPort);
		expect(out).toContain(`the agent on 127.0.0.1:${unhealthyPort} reports a problem`);
		expect(out).toContain('How to fix: Start the Safe Context agent');
	});

	it('rejects a port that is not a number', async () => {
		expect(await status('4747; echo hi')).toContain('SC_AGENT_PORT must be a port number');
	});

	it('runs from a plugin path with spaces and non-ASCII characters', async () => {
		const directory = mkdtempSync(join(tmpdir(), 'Safe Context Jos\u00e9 '));
		try {
			const copiedScript = join(directory, 'agent-status.sh');
			copyFileSync(script, copiedScript);
			expect(await statusAt(copiedScript, agent.port)).toContain('enforcing policy version 7.');
			expect(JSON.parse(await statusAt(copiedScript, agent.port, '--session-start')).hookSpecificOutput).toHaveProperty(
				'hookEventName',
				'SessionStart'
			);
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});

	it.skipIf(process.platform !== 'win32')(
		'prepares an inherited Windows hook PATH from a checkout with spaces and non-ASCII characters',
		async () => {
			const directory = mkdtempSync(join(tmpdir(), 'Safe Context Jos\u00e9 '));
			try {
				mkdirSync(join(directory, 'scripts'));
				const helper = join(directory, 'scripts/windows-dev.ps1');
				copyFileSync(join(pluginDir, '../scripts/windows-dev.ps1'), helper);
				copyFileSync(join(pluginDir, '../package.json'), join(directory, 'package.json'));
				const { stdout } = await run(
					'pwsh',
					[
						'-NoProfile',
						'-NonInteractive',
						'-Command',
						'& $env:WINDOWS_HELPER; if ($env:SC_AGENT_PORT -ne $env:EXPECTED_PORT) { throw "Settings changed" }; & sh.exe $env:STATUS_SCRIPT'
					],
					{
						env: {
							...process.env,
							WINDOWS_HELPER: helper,
							STATUS_SCRIPT: script,
							EXPECTED_PORT: String(agent.port),
							SC_AGENT_PORT: String(agent.port)
						}
					}
				);
				expect(stdout).toContain('Windows prerequisites ready');
				expect(stdout).toContain('enforcing policy version 7.');
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it.skipIf(process.platform !== 'win32')(
		'restores existing settings when the isolated demo fails to start',
		async () => {
			const directory = mkdtempSync(join(tmpdir(), 'Safe Context demo failure '));
			try {
				mkdirSync(join(directory, 'scripts'));
				mkdirSync(join(directory, 'apps/agent/node_modules/tsx'), { recursive: true });
				const helper = join(directory, 'scripts/windows-dev.ps1');
				copyFileSync(join(pluginDir, '../scripts/windows-dev.ps1'), helper);
				copyFileSync(join(pluginDir, '../package.json'), join(directory, 'package.json'));
				// Stand in for a failed agent process: no server, dependencies or model calls.
				writeFileSync(
					join(directory, 'pnpm.cmd'),
					'@echo off\r\nif "%1"=="--version" (\r\n echo 12.14.0\r\n exit /b 0\r\n)\r\nexit /b 9\r\n'
				);
				const { stdout } = await run(
					'pwsh',
					[
						'-NoProfile',
						'-NonInteractive',
						'-Command',
						'$env:PATH = $env:FAKE_TOOLS + ";" + $env:PATH; try { & $env:WINDOWS_HELPER -StartAgent; throw "Unexpected success" } catch { if ($_.Exception.Message -notlike "*exit code 9*") { throw } }; if ($env:SC_AGENT_PORT -ne "12345" -or $env:SC_TIER2_BASE_URL -ne "demo-sentinel") { throw "Settings were not restored" }; "Settings restored after failed startup"'
					],
					{
						env: {
							...process.env,
							FAKE_TOOLS: directory,
							WINDOWS_HELPER: helper,
							SC_AGENT_PORT: '12345',
							SC_TIER2_BASE_URL: 'demo-sentinel'
						}
					}
				);
				expect(stdout).toContain('Settings restored after failed startup');
			} finally {
				rmSync(directory, { recursive: true, force: true });
			}
		}
	);

	it.skipIf(process.platform !== 'win32')(
		'rejects a missing Git installation without changing the caller PATH',
		async () => {
			const { stdout } = await run(
				'pwsh',
				[
					'-NoProfile',
					'-NonInteractive',
					'-Command',
					'$before = $env:PATH; try { & $env:WINDOWS_HELPER -GitRoot $env:MISSING_GIT; throw "Unexpected success" } catch { if ($env:PATH -cne $before) { throw "PATH changed" }; if ($_.Exception.Message -eq "Unexpected success") { throw }; "Rejected missing Git; PATH unchanged" }'
				],
				{
					env: {
						...process.env,
						WINDOWS_HELPER: join(pluginDir, '../scripts/windows-dev.ps1'),
						MISSING_GIT: join(tmpdir(), 'Safe Context missing Git', 'does-not-exist')
					}
				}
			);
			expect(stdout).toContain('Rejected missing Git; PATH unchanged');
		}
	);
});

describe('agent-status.sh --session-start (SessionStart hook)', () => {
	it("passes on the agent's note for Claude when the agent is healthy, and shows the user nothing", async () => {
		const out = JSON.parse(await status(agent.port, '--session-start'));
		expect(AGENT_API.sessionStart.response.parse(out)).toEqual(out);
		expect(out.hookSpecificOutput.additionalContext).toContain('⟪customer_name_1⟫');
		expect(Object.keys(out)).toEqual(['hookSpecificOutput']);
	});

	it('prints nothing if the agent answers its health check but not the note', async () => {
		expect(await status(healthOnlyPort, '--session-start')).toBe('');
	});

	it('prints hook JSON with a systemMessage for the user when the agent is down', async () => {
		const out = JSON.parse(await status(await freePort(), '--session-start'));
		expect(Object.keys(out)).toEqual(['systemMessage']);
		expect(out.systemMessage).toMatch(/^Safe Context: the agent isn't running .* Start the Safe Context agent/);
	});

	it('prints valid JSON for every problem', async () => {
		for (const port of [notAgentPort, unhealthyPort, 'nope']) {
			expect(JSON.parse(await status(port, '--session-start')).systemMessage).toMatch(/^Safe Context: /);
		}
	});
});

describe('plugin wiring', () => {
	const hooks = JSON.parse(readFileSync(join(pluginDir, 'hooks/hooks.json'), 'utf8')).hooks;
	const scriptText = readFileSync(script, 'utf8');

	it('runs the health check on SessionStart', () => {
		expect(hooks.SessionStart[0].hooks[0]).toMatchObject({
			type: 'command',
			command: 'sh',
			args: ['${CLAUDE_PLUGIN_ROOT}/scripts/agent-status.sh', '--session-start']
		});
	});

	it('the status skill runs the same script', () => {
		const skill = readFileSync(join(pluginDir, 'skills/status/SKILL.md'), 'utf8');
		// Quoted, so a plugin path with a space still works.
		expect(skill).toContain('!`sh "${CLAUDE_PLUGIN_ROOT}/scripts/agent-status.sh"`');
		expect(skill).toContain('allowed-tools: Bash(sh "${CLAUDE_PLUGIN_ROOT}/scripts/agent-status.sh")');
	});

	it('checks every tool, including subagents (Agent) and tools added later (issue #41)', () => {
		for (const event of ['PreToolUse', 'PostToolUse']) {
			expect(hooks[event]).toHaveLength(1);
			expect(hooks[event][0].matcher).toBe('*');
		}
	});

	it('uses the agent API default port and health path', () => {
		expect(scriptText).toContain(`port="\${SC_AGENT_PORT:-${AGENT_DEFAULT_PORT}}"`);
		expect(scriptText).toContain(`http://${AGENT_HOST}:\${port}${AGENT_API.health.path}`);
	});
});
