import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { knownValueFinder } from './known.ts';
import { createPlaceholderStore, type SessionKey } from './placeholders.ts';
import { isSafeWriteTarget, restoreToolInput } from './restore.ts';
import { LOCAL_SWAP_BACK_TOOLS } from '@safecontext/policy';

const LOCAL = [...LOCAL_SWAP_BACK_TOOLS];

const project = realpathSync(mkdtempSync(join(tmpdir(), 'sc-restore-')));
mkdirSync(join(project, 'deals'));

function keyWith(values: Record<string, string>): SessionKey {
	const key = createPlaceholderStore().session('s');
	for (const [value, dataTypeId] of Object.entries(values)) key.idFor(dataTypeId, value);
	return key;
}
const key = () =>
	keyWith({
		Northwind: 'customer-names',
		'jane@northwind.example': 'customer-personal-data',
		'$4.2M': 'revenue-figures'
	});

describe('restoreToolInput', () => {
	it('puts real values back into a file path and file content', () => {
		const r = restoreToolInput(
			'Write',
			{ file_path: 'deals/⟪customer_name_1⟫-renewal.md', content: 'Dear ⟪customer_personal_data_1: ****mple⟫' },
			key(),
			project,
			LOCAL
		);
		expect(r).toEqual({
			kind: 'restored',
			count: 2,
			confirm: false,
			input: { file_path: 'deals/Northwind-renewal.md', content: 'Dear jane@northwind.example' }
		});
	});

	it('swaps nested fields and keeps every other value as it was', () => {
		const r = restoreToolInput(
			'MultiEdit',
			{
				file_path: `${project}/a.md`,
				edits: [{ old_string: 'paid ⟪revenue_figure_1⟫', new_string: 'x', replace_all: false }]
			},
			key(),
			project,
			LOCAL
		);
		expect(r).toMatchObject({
			kind: 'restored',
			input: { edits: [{ old_string: 'paid $4.2M', new_string: 'x', replace_all: false }] }
		});
	});

	it('escapes values put into a Grep pattern, so they match as plain text', () => {
		const r = restoreToolInput('Grep', { pattern: 'paid ⟪revenue_figure_1⟫', path: '.' }, key(), project, LOCAL);
		expect(r).toMatchObject({ kind: 'restored', input: { pattern: 'paid \\$4\\.2M', path: '.' } });
	});

	it('reads anywhere: reading sends nothing off the Mac', () => {
		const path = join(dirname(project), 'elsewhere', '⟪customer_name_1⟫.md');
		const r = restoreToolInput('Read', { file_path: path }, key(), project, LOCAL);
		expect(r).toMatchObject({ kind: 'restored', input: { file_path: path.replace('⟪customer_name_1⟫', 'Northwind') } });
	});

	it.each(['Bash', 'WebFetch', 'WebSearch', 'Agent', 'mcp__slack__send', 'SomeNewTool'])(
		'by default, never puts real values into %s',
		(tool) => {
			expect(restoreToolInput(tool, { command: 'echo ⟪customer_name_1⟫' }, key(), project, LOCAL)).toEqual({
				kind: 'none'
			});
		}
	);

	it('does nothing without a placeholder', () => {
		expect(restoreToolInput('Read', { file_path: 'a.md' }, key(), project, LOCAL)).toEqual({ kind: 'none' });
	});

	it("refuses a placeholder the key doesn't hold, naming it", () => {
		const r = restoreToolInput('Read', { file_path: '⟪customer_name_1⟫/⟪customer_name_9⟫.md' }, key(), project, LOCAL);
		expect(r).toEqual({ kind: 'refused', reason: 'unknown_placeholder', ids: ['customer_name_9'] });
	});

	it.each([
		['outside the project', join(dirname(project), 'outside.md')],
		['above the project', '../notes.md'],
		['in .git', '.git/hooks/pre-commit'],
		['in .claude', '.claude/notes.md'],
		['in a hidden folder deeper down', 'deals/.cache/a.md'],
		['into a hidden file', '.bashrc'],
		['into a protected file', 'lefthook.yml']
	])('refuses to write real values %s', (_why, path) => {
		const r = restoreToolInput('Write', { file_path: path, content: '⟪customer_name_1⟫' }, key(), project, LOCAL);
		expect(r).toEqual({ kind: 'refused', reason: 'outside_project', ids: [] });
	});

	it('writes real values into .env files', () => {
		for (const name of ['.env', '.env.local', 'deals/.env.production']) {
			expect(
				restoreToolInput(
					'Edit',
					{ file_path: name, old_string: 'X=1', new_string: 'X=⟪customer_name_1⟫' },
					key(),
					project,
					LOCAL
				).kind
			).toBe('restored');
		}
	});
});

describe('tools the policy adds', () => {
	const tools = [...LOCAL, 'mcp__slack__*', 'Bash'];

	it('puts real values into an added MCP tool, and asks the user to confirm', () => {
		const r = restoreToolInput(
			'mcp__slack__send_message',
			{ channel: 'sales', text: 'Renewal: ⟪customer_name_1⟫' },
			key(),
			project,
			tools
		);
		expect(r).toEqual({
			kind: 'restored',
			count: 1,
			confirm: true,
			input: { channel: 'sales', text: 'Renewal: Northwind' }
		});
	});

	it('local file tools keep the normal permission flow', () => {
		const r = restoreToolInput('Read', { file_path: '⟪customer_name_1⟫.md' }, key(), project, tools);
		expect(r).toMatchObject({ kind: 'restored', confirm: false });
	});

	it('puts real values into Bash when added, but never into a command outside the sandbox', () => {
		expect(
			restoreToolInput('Bash', { command: 'grep ⟪customer_name_1⟫ crm.csv' }, key(), project, tools)
		).toMatchObject({
			kind: 'restored',
			confirm: true,
			input: { command: 'grep Northwind crm.csv' }
		});
		expect(
			restoreToolInput(
				'Bash',
				{ command: 'grep ⟪customer_name_1⟫ x', dangerouslyDisableSandbox: true },
				key(),
				project,
				tools
			)
		).toEqual({ kind: 'refused', reason: 'sandbox_escape', ids: [] });
	});

	it('leaves a tool the policy no longer lists alone, even a local one', () => {
		expect(restoreToolInput('Read', { file_path: '⟪customer_name_1⟫.md' }, key(), project, ['Write'])).toEqual({
			kind: 'none'
		});
	});

	it('never puts real values into a tool whose input reaches an Anthropic model, whatever the list says', () => {
		for (const tool of ['Agent', 'Task', 'WebFetch', 'WebSearch']) {
			expect(restoreToolInput(tool, { prompt: '⟪customer_name_1⟫' }, key(), project, [tool])).toEqual({ kind: 'none' });
		}
	});
});

describe('spellings', () => {
	// One customer, two spellings: "Northwind" in a document, "northwind" in a file name.
	const spelled = () => {
		const key = createPlaceholderStore().session('s');
		key.idFor('customer-names', 'Northwind');
		key.idFor('customer-names', 'northwind');
		return key;
	};
	writeFileSync(join(project, 'deals', 'northwind-renewal.md'), 'Renewal for northwind: 3 years\n');

	it('opens the file by the spelling it has on disk, even on a disk that ignores case', () => {
		const r = restoreToolInput('Read', { file_path: 'deals/⟪customer_name_1⟫-renewal.md' }, spelled(), project, LOCAL);
		expect(r).toMatchObject({ kind: 'restored', input: { file_path: 'deals/northwind-renewal.md' } });
	});

	it("matches an Edit's old_string to the spelling in the file, and writes new text with the first", () => {
		const r = restoreToolInput(
			'Edit',
			{
				file_path: 'deals/northwind-renewal.md',
				old_string: 'for ⟪customer_name_1⟫:',
				new_string: 'for ⟪customer_name_1⟫ Ltd:'
			},
			spelled(),
			project,
			LOCAL
		);
		expect(r).toMatchObject({
			kind: 'restored',
			input: { old_string: 'for northwind:', new_string: 'for Northwind Ltd:' }
		});
	});

	it('uses the first spelling for a new file whose name matches nothing', () => {
		const r = restoreToolInput(
			'Write',
			{ file_path: 'deals/⟪customer_name_1⟫-notes.md', content: 'x' },
			spelled(),
			project,
			LOCAL
		);
		expect(r).toMatchObject({ kind: 'restored', input: { file_path: 'deals/Northwind-notes.md' } });
	});
});

describe('isSafeWriteTarget', () => {
	it('follows symlinks out of the project', () => {
		const outside = realpathSync(mkdtempSync(join(tmpdir(), 'sc-outside-')));
		symlinkSync(outside, join(project, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
		expect(isSafeWriteTarget('link/new.md', project)).toBe(false);
		expect(isSafeWriteTarget('deals/new.md', project)).toBe(true);
	});

	it('needs an absolute project folder and a file inside it', () => {
		expect(isSafeWriteTarget('a.md', 'relative')).toBe(false);
		expect(isSafeWriteTarget('.', project)).toBe(false);
	});
});

describe('knownValueFinder', () => {
	it('finds every value the key holds, whole words, any case', () => {
		const find = knownValueFinder(key());
		const text = 'NORTHWIND paid $4.2M; Northwinds no; mail jane@northwind.example';
		expect(find(text).map((s) => [text.slice(s.start, s.end), s.dataTypeId])).toEqual([
			['NORTHWIND', 'customer-names'],
			['$4.2M', 'revenue-figures'],
			['jane@northwind.example', 'customer-personal-data']
		]);
	});

	it('leaves very short values to the tiers', () => {
		expect(knownValueFinder(keyWith({ '42': 'internal-metrics' }))('42 and 42')).toEqual([]);
	});
});
