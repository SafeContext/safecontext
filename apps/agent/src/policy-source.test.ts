import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { readConfig } from './config.ts';
import { memoryLogger } from './log.ts';
import { filePolicySource } from './policy-source.ts';
import { policyWith } from './test-helpers.ts';

const dir = mkdtempSync(join(tmpdir(), 'sc-agent-policy-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const file = (name: string, content: string) => {
	const path = join(dir, name);
	writeFileSync(path, content);
	return path;
};

describe('filePolicySource', () => {
	it('loads a valid policy file', () => {
		const logger = memoryLogger();
		const path = file('ok.json', JSON.stringify(policyWith({ version: 12, failMode: 'allow' })));
		const source = filePolicySource(path, logger);
		expect(source.kind).toBe('file');
		expect(source.current()).toMatchObject({ version: 12, failMode: 'allow' });
		expect(logger.records).toEqual([{ level: 'info', msg: 'policy_loaded', policySource: 'file', policyVersion: 12 }]);
	});

	it('uses defaultPolicy() with no path', () => {
		const source = filePolicySource(undefined, memoryLogger());
		expect(source.kind).toBe('default');
		expect(source.current()).toMatchObject({ version: 0, failMode: 'block' });
	});

	it.each([
		['missing', join(dir, 'nope.json')],
		['not_json', file('bad.json', '{ nope')],
		['invalid', file('invalid.json', JSON.stringify({ version: -1, dataTypes: [] }))]
	])('falls back to defaultPolicy() when the file is %s, and logs why without contents', (error, path) => {
		const logger = memoryLogger();
		const source = filePolicySource(path, logger);
		expect(source.kind).toBe('default');
		expect(source.current().version).toBe(0);
		expect(logger.records[0]).toMatchObject({ level: 'warn', msg: 'policy_fallback', policyError: error });
	});
});

describe('readConfig', () => {
	it('has defaults', () => {
		expect(readConfig({})).toEqual({ port: 4747, policyFile: undefined, checkBudgetMs: 8_000 });
	});

	it('reads the env', () => {
		expect(readConfig({ SC_AGENT_PORT: '5000', SC_POLICY_FILE: '/p.json', SC_CHECK_BUDGET_MS: '250' })).toEqual({
			port: 5000,
			policyFile: '/p.json',
			checkBudgetMs: 250
		});
	});

	it('rejects bad numbers', () => {
		expect(() => readConfig({ SC_AGENT_PORT: 'abc' })).toThrow(/SC_AGENT_PORT/);
		expect(() => readConfig({ SC_CHECK_BUDGET_MS: '60000' })).toThrow(/SC_CHECK_BUDGET_MS/);
	});
});
