/**
 * The plugin's health check script (`plugin/scripts/agent-status.sh`), run with `sh` against a
 * real agent on an ephemeral port. Used by the SessionStart hook and the /safe-context:status
 * skill. No Claude Code here, so this runs in the default `pnpm test`.
 */
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
	const { stdout } = await run('sh', [script, ...args], { env: { ...process.env, SC_AGENT_PORT: String(port) } });
	return stdout;
}

let agent: RunningServer;
let notAgent: Server;
let notAgentPort: number;
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
});
afterAll(async () => {
	await agent.close();
	await new Promise((resolve) => notAgent.close(resolve));
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

	it('rejects a port that is not a number', async () => {
		expect(await status('4747; echo hi')).toContain('SC_AGENT_PORT must be a port number');
	});
});

describe('agent-status.sh --session-start (SessionStart hook)', () => {
	it('prints nothing when the agent is healthy, so nothing is added to the session', async () => {
		expect(await status(agent.port, '--session-start')).toBe('');
	});

	it('prints hook JSON with a systemMessage for the user when the agent is down', async () => {
		const out = JSON.parse(await status(await freePort(), '--session-start'));
		expect(Object.keys(out)).toEqual(['systemMessage']);
		expect(out.systemMessage).toMatch(/^Safe Context: the agent isn't running .* Start the Safe Context agent/);
	});

	it('prints valid JSON for every problem', async () => {
		for (const port of [notAgentPort, 'nope']) {
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
		expect(skill).toContain('!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/agent-status.sh`');
		expect(skill).toContain('allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/agent-status.sh)');
	});

	it('uses the agent API default port and health path', () => {
		expect(scriptText).toContain(`port="\${SC_AGENT_PORT:-${AGENT_DEFAULT_PORT}}"`);
		expect(scriptText).toContain(`http://${AGENT_HOST}:\${port}${AGENT_API.health.path}`);
	});
});
