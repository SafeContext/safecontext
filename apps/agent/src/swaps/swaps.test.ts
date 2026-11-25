/** Placeholder keys that outlive the agent, and the local swap record (#85). */
import { mkdtempSync, readdirSync, readFileSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AGENT_API } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { createTier0 } from '../classifier/tier0.ts';
import { memoryLogger } from '../log.ts';
import { memoryTokenStore } from '../sync/token-store.ts';
import { fakeTier, testApp, toolInput, toolOutput, promptInput, SECRET } from '../test-helpers.ts';
import { createPlaceholderStore } from '../transform/placeholders.ts';
import { formatSwaps, parseDuration, parseSwapsArgs, runCli, selectSwaps } from '../cli.ts';
import { loadOrCreateVaultKey } from './data-key.ts';
import { openVault } from './index.ts';
import { createSwapLog, readSwapLog, SWAP_LOG_FILE, SWAP_LOG_OLD_FILE, type SwapRecord } from './swap-log.ts';
import { createFileVault, decrypt, encrypt, vaultFileName, type SessionSnapshot } from './vault.ts';

const { toolInput: preTool, toolOutput: postTool, prompt } = AGENT_API;
const HOUR = 3_600_000;
const tmp = () => mkdtempSync(join(tmpdir(), 'sc-swaps-'));
const key32 = () => randomBytes(32);

const snapshot = (lastUsed: number): SessionSnapshot => ({
	lastUsed,
	counters: [['customer_name', 2]],
	entries: [
		{
			id: 'customer_name_1',
			dataTypeId: 'customer-names',
			value: 'Northwind',
			spellings: ['Northwind', 'northwind'],
			hints: []
		},
		{ id: 'customer_name_2', dataTypeId: 'customer-names', value: 'Contoso', spellings: ['Contoso'], hints: [] }
	]
});

describe('the key vault', () => {
	it('saves and loads a session, encrypted, under a name that hides the session id', () => {
		const dir = tmp();
		const vault = createFileVault({ dir, key: key32() });
		vault.save('session-abc', snapshot(Date.now()));
		expect(vault.load('session-abc')).toEqual(snapshot(expect.any(Number) as unknown as number));
		const [name] = readdirSync(dir);
		expect(name).toBe(vaultFileName('session-abc'));
		expect(name).not.toContain('session-abc');
		const raw = readFileSync(join(dir, name!));
		expect(raw.toString('latin1')).not.toContain('Northwind');
		expect(vault.load('other-session')).toBeUndefined();
	});

	it("can't be read with another key, or after a file is moved to another session's name", () => {
		const dir = tmp();
		const errors: string[] = [];
		const vault = createFileVault({ dir, key: key32(), onError: (c) => errors.push(c) });
		vault.save('a', snapshot(Date.now()));
		vault.save('b', snapshot(Date.now()));
		renameSync(join(dir, vaultFileName('a')), join(dir, vaultFileName('b')));
		expect(vault.load('b')).toBeUndefined(); // the name is part of what is authenticated
		vault.save('c', snapshot(Date.now()));
		expect(createFileVault({ dir, key: key32(), onError: (c) => errors.push(c) }).load('c')).toBeUndefined();
		expect(errors).toEqual(['vault_read_failed', 'vault_read_failed']);
		expect(readdirSync(dir)).toEqual([]); // unreadable files are deleted
	});

	it('forgets a session idle for 12 hours, on load and in the sweep', () => {
		const dir = tmp();
		let now = Date.now();
		const vault = createFileVault({ dir, key: key32(), now: () => now });
		vault.save('old', snapshot(now - 13 * HOUR));
		expect(vault.load('old')).toBeUndefined();
		vault.save('kept', snapshot(now));
		vault.save('stale', snapshot(now));
		const stalePath = join(dir, vaultFileName('stale'));
		utimesSync(stalePath, new Date(now - 13 * HOUR), new Date(now - 13 * HOUR));
		writeFileSync(join(dir, 'x.key.123.tmp'), 'left over');
		expect(vault.sweep()).toBe(2);
		expect(readdirSync(dir)).toEqual([vaultFileName('kept')]);
		now += 13 * HOUR;
		expect(vault.load('kept')).toBeUndefined();
	});

	it('rejects tampered data', () => {
		const key = key32();
		const data = encrypt(key, Buffer.from('hello'), 'n');
		expect(decrypt(key, data, 'n').toString()).toBe('hello');
		data[data.length - 1]! ^= 1;
		expect(() => decrypt(key, data, 'n')).toThrow();
	});

	it('keeps its encryption key in the store, and makes one the first time', async () => {
		const store = memoryTokenStore();
		const first = await loadOrCreateVaultKey(store);
		expect(first).toHaveLength(32);
		expect(await loadOrCreateVaultKey(store)).toEqual(first);
		await store.set('too-short');
		expect(await loadOrCreateVaultKey(store)).not.toEqual(first);
	});

	it('is off, not fatal, without a Keychain', async () => {
		const logger = memoryLogger();
		expect(await openVault(tmp(), logger, null)).toBeUndefined();
		const broken = { ...memoryTokenStore(), get: () => Promise.reject(new Error('locked')) };
		expect(await openVault(tmp(), logger, broken)).toBeUndefined();
		expect(logger.records.map((r) => r.msg)).toEqual(['vault_off', 'vault_off']);
		const opened = await openVault(tmp(), logger, memoryTokenStore());
		expect(opened).toBeDefined();
		opened!.close();
		expect(logger.records.at(-1)).toMatchObject({ msg: 'vault_ready', deleted: 0 });
	});
});

describe('placeholder keys across a restart', () => {
	it('carries on where it left off: same placeholders, spellings and hints, and no number reused', () => {
		const vault = createFileVault({ dir: tmp(), key: key32() });
		const before = createPlaceholderStore({ vault });
		const a = before.session('S');
		expect(a.idFor('customer-names', 'Northwind')).toBe('customer_name_1');
		a.idFor('customer-names', 'northwind');
		a.noteHint('customer_name_1', 'a customer');
		before.flush();

		const after = createPlaceholderStore({ vault }).session('S');
		expect(after.valueOf('customer_name_1')).toBe('Northwind');
		expect(after.spellingsOf('customer_name_1')).toEqual(['Northwind', 'northwind']);
		expect(after.issued('customer_name_1', 'a customer')).toBe(true);
		expect(after.idFor('customer-names', 'NORTHWIND')).toBe('customer_name_1');
		expect(after.idFor('customer-names', 'Contoso')).toBe('customer_name_2');
	});

	it('saves changes shortly after they happen, and reloads a session dropped from memory', async () => {
		const vault = createFileVault({ dir: tmp(), key: key32() });
		const store = createPlaceholderStore({ vault, saveDelayMs: 5, maxSessions: 1 });
		store.session('S').idFor('customer-names', 'Northwind');
		await new Promise((r) => setTimeout(r, 30));
		expect(vault.load('S')?.entries.map((e) => e.value)).toEqual(['Northwind']);
		store.session('T'); // pushes S out of memory
		expect(store.session('S').valueOf('customer_name_1')).toBe('Northwind');
	});

	it('loses nothing when a session is pushed out of memory before it was saved', () => {
		const vault = createFileVault({ dir: tmp(), key: key32() });
		const store = createPlaceholderStore({ vault, saveDelayMs: 60_000, maxSessions: 1 });
		store.session('S').idFor('customer-names', 'Northwind');
		store.session('T');
		expect(store.session('S').valueOf('customer_name_1')).toBe('Northwind');
		store.flush();
		expect(vault.load('S')?.entries).toHaveLength(1);
	});

	it('lets Claude write a placeholder it got before the agent restarted', async () => {
		const dir = tmp();
		const key = key32();
		const contextTier = fakeTier({
			spans: (texts) =>
				texts.map((t) =>
					t.startsWith('CRM')
						? [{ start: 5, end: 14, dataTypeId: 'customer-names', source: 'tagger' as const, confidence: 0.9 }]
						: []
				)
		});
		const first = createPlaceholderStore({ vault: createFileVault({ dir, key }) });
		const before = testApp({ tiers: [createTier0(), contextTier], placeholders: first });
		await before.post(postTool.path, toolOutput('Bash', { stdout: 'CRM: Northwind renews', stderr: '' }));
		first.flush();

		const after = testApp({ placeholders: createPlaceholderStore({ vault: createFileVault({ dir, key }) }) });
		const res = await after.post(
			preTool.path,
			toolInput('Write', { file_path: 'notes.md', content: 'Call ⟪customer_name_1⟫' })
		);
		expect(preTool.response.parse(res.json).hookSpecificOutput?.updatedInput).toEqual({
			file_path: 'notes.md',
			content: 'Call Northwind'
		});
	});
});

describe('the swap record', () => {
	const entry = (over: Partial<SwapRecord> = {}): SwapRecord => ({
		ts: '2026-11-24T10:00:00.000Z',
		session: 'session-1',
		action: 'hidden',
		placeholders: ['customer_name_1'],
		hook: 'PostToolUse',
		tool: 'Read',
		path: '/work/notes.md',
		...over
	});

	it('appends lines, skips empty records and damaged lines, and starts a new file when full', () => {
		const dir = tmp();
		const log = createSwapLog({ dir, maxBytes: 300 });
		log.record(entry({ placeholders: [] }));
		expect(readSwapLog(dir)).toEqual([]);
		for (let i = 0; i < 5; i++) log.record(entry({ placeholders: [`customer_name_${i + 1}`] }));
		writeFileSync(join(dir, SWAP_LOG_FILE), readFileSync(join(dir, SWAP_LOG_FILE), 'utf8') + '{"ts":');
		const all = readSwapLog(dir);
		expect(all.map((r) => r.placeholders[0])).toEqual(
			['customer_name_1', 'customer_name_2', 'customer_name_3', 'customer_name_4', 'customer_name_5'].slice(-all.length)
		);
		expect(readdirSync(dir).sort()).toEqual([SWAP_LOG_OLD_FILE, SWAP_LOG_FILE].sort());
	});

	it('records what was hidden and put back, where, and never a real value', async () => {
		const dir = tmp();
		const tier = fakeTier({
			spans: (texts) =>
				texts.map((t) => {
					const i = t.indexOf('Northwind');
					return i === -1 || !t.startsWith('Deal')
						? []
						: [{ start: i, end: i + 9, dataTypeId: 'customer-names', source: 'tagger' as const, confidence: 0.9 }];
				})
		});
		const { post, logger } = testApp({ tiers: [createTier0(), tier], swapLog: createSwapLog({ dir }) });
		await post(postTool.path, {
			...toolOutput('Read', {
				type: 'text',
				file: {
					filePath: '/work/project/deal.md',
					content: 'Deal: Northwind',
					numLines: 1,
					startLine: 1,
					totalLines: 1
				}
			}),
			tool_input: { file_path: '/work/project/deal.md' }
		});
		await post(preTool.path, toolInput('Write', { file_path: '/work/project/out.md', content: '⟪customer_name_1⟫' }));
		await post(prompt.path, promptInput(`use ${SECRET} please`));
		await post(postTool.path, toolOutput('Bash', { stdout: 'nothing here', stderr: '' }));

		const records = readSwapLog(dir);
		expect(records).toMatchObject([
			{
				session: 'SESSION_ID',
				action: 'hidden',
				hook: 'PostToolUse',
				tool: 'Read',
				path: '/work/project/deal.md',
				placeholders: ['customer_name_1']
			},
			{
				action: 'restored',
				hook: 'PreToolUse',
				tool: 'Write',
				path: '/work/project/out.md',
				placeholders: ['customer_name_1']
			},
			{ action: 'hidden', hook: 'UserPromptSubmit', placeholders: [expect.stringMatching(/_1$/)] }
		]);
		expect(records[2]).not.toHaveProperty('tool');
		const raw = readFileSync(join(dir, SWAP_LOG_FILE), 'utf8');
		expect(raw).not.toContain('Northwind');
		expect(raw).not.toContain(SECRET);
		expect(JSON.stringify(logger.records)).not.toContain('Northwind');
	});
});

describe('the swap record and file paths (PR #135 review)', () => {
	const tier = fakeTier({
		spans: (texts) =>
			texts.map((t) => {
				const i = t.indexOf('Northwind');
				return i === -1 || !t.startsWith('CRM')
					? []
					: [{ start: i, end: i + 9, dataTypeId: 'customer-names', source: 'tagger' as const, confidence: 0.9 }];
			})
	});

	it('records a path with placeholders, never the value put back into it', async () => {
		const dir = tmp();
		const { post } = testApp({ tiers: [createTier0(), tier], swapLog: createSwapLog({ dir }) });
		await post(postTool.path, toolOutput('Bash', { stdout: 'CRM: Northwind renews', stderr: '' }));
		const read = await post(preTool.path, toolInput('Read', { file_path: 'deals/⟪customer_name_1⟫-renewal.md' }));
		expect(preTool.response.parse(read.json).hookSpecificOutput?.updatedInput).toEqual({
			file_path: 'deals/Northwind-renewal.md'
		});
		// What ran comes back with the real path; the record still shows the placeholder.
		await post(postTool.path, {
			...toolOutput('Read', {
				type: 'text',
				file: {
					filePath: 'deals/Northwind-renewal.md',
					content: 'CRM: Northwind',
					numLines: 1,
					startLine: 1,
					totalLines: 1
				}
			}),
			tool_input: { file_path: 'deals/NORTHWIND-renewal.md' }
		});
		const records = readSwapLog(dir);
		expect(records.map((r) => [r.action, r.path])).toEqual([
			['hidden', undefined],
			['restored', 'deals/⟪customer_name_1⟫-renewal.md'],
			['hidden', 'deals/⟪customer_name_1⟫-renewal.md']
		]);
		expect(readFileSync(join(dir, SWAP_LOG_FILE), 'utf8').toLowerCase()).not.toContain('northwind');
	});

	it('writes no key file and no record for a check that hid nothing', async () => {
		const keys = tmp();
		const log = tmp();
		const placeholders = createPlaceholderStore({
			vault: createFileVault({ dir: keys, key: key32() }),
			saveDelayMs: 1
		});
		const { post } = testApp({ placeholders, swapLog: createSwapLog({ dir: log }) });
		await post(prompt.path, promptInput('Tidy the imports in app.ts'));
		await post(postTool.path, toolOutput('Bash', { stdout: 'all good', stderr: '' }));
		placeholders.flush();
		expect(readdirSync(keys)).toEqual([]);
		expect(readdirSync(log)).toEqual([]);
	});
});

describe('safecontext swaps', () => {
	const records: SwapRecord[] = [
		{
			ts: '2026-11-24T08:00:00.000Z',
			session: 'aaaa1111-x',
			action: 'hidden',
			placeholders: ['customer_name_1'],
			hook: 'PostToolUse',
			tool: 'Read',
			path: 'deal.md'
		},
		{
			ts: '2026-11-24T09:30:00.000Z',
			session: 'bbbb2222-y',
			action: 'restored',
			placeholders: ['customer_name_1', 'revenue_figure_2'],
			hook: 'PreToolUse',
			tool: 'Write',
			path: 'out.md'
		},
		{
			ts: '2026-11-24T09:45:00.000Z',
			session: 'bbbb2222-y',
			action: 'hidden',
			placeholders: ['secret_1'],
			hook: 'UserPromptSubmit'
		}
	];
	const now = Date.parse('2026-11-24T10:00:00.000Z');

	it('reads its options', () => {
		expect(parseSwapsArgs([])).toEqual({ limit: 50, json: false });
		expect(parseSwapsArgs(['--', '--json'])).toEqual({ limit: 50, json: true });
		expect(parseSwapsArgs(['--session', 'bbbb', '--since', '1h', '--limit', '5', '--json'])).toEqual({
			session: 'bbbb',
			sinceMs: HOUR,
			limit: 5,
			json: true
		});
		expect(parseSwapsArgs(['--since', 'soon'])).toMatch(/^Usage/);
		expect(parseSwapsArgs(['--what'])).toMatch(/^Usage/);
		expect(parseDuration('7d')).toBe(7 * 24 * HOUR);
	});

	it('filters by session start and age, keeping the newest', () => {
		expect(selectSwaps(records, { session: 'bbbb', limit: 50, json: false }, now)).toHaveLength(2);
		expect(selectSwaps(records, { sinceMs: HOUR, limit: 50, json: false }, now)).toHaveLength(2);
		expect(selectSwaps(records, { limit: 1, json: false }, now)).toEqual([records[2]]);
	});

	it('prints a table with placeholders, never values', () => {
		const text = formatSwaps(records);
		const lines = text.split('\n');
		expect(lines[0]).toMatch(/^Time\s+Session\s+Action\s+Tool\s+Placeholders\s+File$/);
		expect(lines[2]).toContain('put back');
		expect(lines[2]).toContain('⟪customer_name_1⟫ ⟪revenue_figure_2⟫');
		expect(lines[3]).toContain('prompt');
		expect(formatSwaps([])).toBe('No swaps recorded.');
	});

	it('runs from the state folder', () => {
		const dir = tmp();
		const log = createSwapLog({ dir });
		for (const r of records) log.record(r);
		const out: string[] = [];
		expect(runCli(['swaps', '--json'], dir, (t) => out.push(t))).toBe(0);
		expect(JSON.parse(out[0]!)).toEqual(records);
		expect(runCli(['nope'], dir, (t) => out.push(t))).toBe(2);
	});
});
