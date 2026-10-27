/** Helpers for the plugin tests in this folder. */
import { spawn, type ChildProcess } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { AGENT_DEFAULT_PORT, AGENT_HOST } from '@safecontext/policy';

export const agentDir = join(import.meta.dirname, '..');
export const pluginDir = join(agentDir, '../../plugin');

/** A port nothing is listening on (bind to 0, read the port, close). */
export function freePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = createServer();
		server.once('error', reject);
		server.listen(0, AGENT_HOST, () => {
			const { port } = server.address() as { port: number };
			server.close(() => resolve(port));
		});
	});
}

/**
 * Copy the plugin to `dest` with its hook URLs pointing at `port`. Claude Code doesn't expand
 * variables in an `http` hook's `url` (only in `headers`), so the test can't redirect the real
 * plugin to an ephemeral port any other way. Everything else in the copy is unchanged.
 */
export function pluginOnPort(dest: string, port: number): string {
	cpSync(pluginDir, dest, { recursive: true });
	const file = join(dest, 'hooks/hooks.json');
	const from = `http://${AGENT_HOST}:${AGENT_DEFAULT_PORT}/`;
	const text = readFileSync(file, 'utf8');
	const count = text.split(from).length - 1;
	if (count !== 3) throw new Error(`expected 3 hook URLs starting ${from} in hooks.json, found ${count}`);
	writeFileSync(file, text.replaceAll(from, `http://${AGENT_HOST}:${port}/`));
	return dest;
}

export interface RunningAgent {
	port: number;
	stop(): Promise<void>;
}

/** Start the real agent entry point (`src/index.ts`) on a free port with the default policy. */
export function startAgent(): Promise<RunningAgent> {
	const env = withoutAgentEnv(process.env);
	env.SC_AGENT_PORT = '0';
	const child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
		cwd: agentDir,
		env,
		stdio: ['ignore', 'ignore', 'pipe']
	});
	return new Promise((resolve, reject) => {
		const fail = (why: string) => {
			child.kill();
			reject(new Error(`agent didn't start: ${why}`));
		};
		const timer = setTimeout(() => fail('timed out'), 30_000);
		child.once('exit', (code) => fail(`exited with ${code}`));
		// The agent logs one JSON object per line on stderr (metadata only, never text).
		createInterface({ input: child.stderr! }).on('line', (line) => {
			let entry: { msg?: string; port?: number };
			try {
				entry = JSON.parse(line);
			} catch {
				return;
			}
			if (entry.msg === 'listening' && entry.port) {
				clearTimeout(timer);
				child.removeAllListeners('exit');
				resolve({ port: entry.port, stop: () => stop(child) });
			}
		});
	});
}

function stop(child: ChildProcess): Promise<void> {
	if (child.exitCode !== null) return Promise.resolve();
	return new Promise((resolve) => {
		child.once('exit', () => resolve());
		child.kill('SIGTERM');
	});
}

/** process.env without any Safe Context agent settings from the developer's shell. */
export function withoutAgentEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('SC_')));
}
