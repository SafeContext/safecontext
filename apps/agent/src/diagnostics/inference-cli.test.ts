/** These subprocess tests deliberately never opt into model execution. */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../../scripts/windows-inference.ts', import.meta.url));
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const canary = 'synthetic-credential-never-echo';

function run(args: string[]) {
	return spawnSync(process.execPath, ['--import', 'tsx', script, ...args], {
		cwd,
		encoding: 'utf8',
		timeout: 15_000,
		windowsHide: true,
		env: { ...process.env, SC_TIER1_MODEL_DIR: canary, SC_TIER2_API_KEY: canary }
	});
}

describe('diagnostic CLI safety gates', () => {
	it.each(['smoke-tier1', 'tier1', 'combined', 'start-tier1', 'start-combined'])(
		'refuses %s without the real-model opt-in',
		(mode) => {
			const result = run([mode]);
			expect(result.status).toBe(1);
			expect(JSON.parse(result.stdout)).toMatchObject({ reason: 'model_run_opt_in_required' });
			expect(result.stdout + result.stderr).not.toContain(canary);
		},
		20_000
	);
	it('redacts argument-parser failures and unknown positional values', () => {
		for (const args of [[`--${canary}`], [canary]]) {
			const result = run(args);
			expect(result.status).toBe(1);
			expect(JSON.parse(result.stdout).status).toBe('not_verified');
			expect(result.stderr).toBe('');
			expect(result.stdout).not.toContain(canary);
		}
	}, 40_000);
});
