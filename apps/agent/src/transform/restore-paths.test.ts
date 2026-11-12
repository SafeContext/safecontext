import {
	existsSync,
	linkSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	readdirSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { LOCAL_SWAP_BACK_TOOLS } from '@safecontext/policy';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { createPlaceholderStore } from './placeholders.ts';
import { isSafeWriteTarget, ordinaryWindowsPath, resolveRestorationPath } from './restore-paths.ts';
import { restoreToolInput } from './restore.ts';

// Observe/refuse filesystem calls in namespace tests; other tests use real temp files and links.
vi.mock('node:fs', async (importOriginal) => {
	const fs = await importOriginal<typeof import('node:fs')>();
	return {
		...fs,
		lstatSync: vi.fn(fs.lstatSync),
		realpathSync: vi.fn(fs.realpathSync),
		readlinkSync: vi.fn(fs.readlinkSync),
		statSync: vi.fn(fs.statSync),
		existsSync: vi.fn(fs.existsSync),
		readFileSync: vi.fn(fs.readFileSync),
		readdirSync: vi.fn(fs.readdirSync)
	};
});

const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'Safe Context W2 Jos\u00e9 ')));
const project = join(fixture, 'project');
const outside = join(fixture, 'project-sibling');
mkdirSync(project);
mkdirSync(outside);
mkdirSync(join(project, 'deals'));
mkdirSync(join(project, '.private'));
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
symlinkSync(join(project, 'deals'), join(project, 'inside-link'), linkType);
symlinkSync(outside, join(project, 'outside-link'), linkType);
symlinkSync(join(project, '.private'), join(project, 'private-link'), linkType);
symlinkSync(join(project, 'deals'), join(project, '.hidden-link'), linkType);
symlinkSync(join(fixture, 'missing'), join(project, 'broken-link'), linkType);
symlinkSync(join(project, 'loop'), join(project, 'loop'), linkType);

afterAll(() => rmSync(fixture, { recursive: true, force: true }));
afterEach(() => vi.clearAllMocks());

const local = [...LOCAL_SWAP_BACK_TOOLS];
function key(value = 'Northwind') {
	const key = createPlaceholderStore().session('w2-synthetic');
	key.idFor('customer-names', value);
	return key;
}

describe('ordinary Windows path syntax (also runs on Unix CI)', () => {
	it.each(['C:\\work\\notes.md', 'c:/work/notes.md', 'deals/notes.md', '.', '..', 'notes Jos\u00e9.md', '.env.local'])(
		'accepts ordinary syntax: %s',
		(path) => expect(ordinaryWindowsPath(path)).toBe(true)
	);
	it.each([
		'',
		'\\\\server\\share\\x',
		'//server/share/x',
		'\\\\?\\C:\\work\\x',
		'\\\\.\\NUL',
		'C:notes.md',
		'\\notes.md',
		'/notes.md',
		'file:stream',
		'C:/work/file:stream',
		'notes.md.',
		'notes.md ',
		'folder. /notes.md',
		'CON',
		'CON .txt',
		' NUL.txt',
		'nul.txt',
		'COM1.log',
		'LPT\u00b9.txt',
		'CONIN$',
		'CONOUT$',
		'PROTEC~1/notes.md',
		'a\0.md',
		'a\n.md',
		'a?.md'
	])('refuses ambiguous/unsupported syntax: %s', (path) => expect(ordinaryWindowsPath(path)).toBe(false));
});

describe('resolved project write boundaries', () => {
	it('allows new nested files, spaces and Unicode under an existing project', () => {
		expect(isSafeWriteTarget('deals/new folder/Jos\u00e9 notes.md', project)).toBe(true);
		expect(isSafeWriteTarget(join(project, 'deals', 'absolute.md'), project)).toBe(true);
		expect(isSafeWriteTarget('..draft.md', project)).toBe(false);
	});
	it.each(['../project-sibling/notes.md', '../notes.md', '.', '.git/config', 'deals/.cache/x', 'lefthook.yml'])(
		'refuses an outside, hidden or protected write: %s',
		(path) => expect(isSafeWriteTarget(path, project)).toBe(false)
	);
	it('requires an existing directory as the project root', () => {
		expect(isSafeWriteTarget('notes.md', join(fixture, 'missing-project'))).toBe(false);
		writeFileSync(join(fixture, 'not-directory'), 'synthetic');
		expect(isSafeWriteTarget('notes.md', join(fixture, 'not-directory'))).toBe(false);
	});
	it('accepts an inside link and refuses a link to a sibling, including new files', () => {
		expect(isSafeWriteTarget('inside-link/new/note.md', project)).toBe(true);
		expect(isSafeWriteTarget('outside-link/new/note.md', project)).toBe(false);
		expect(isSafeWriteTarget(join(outside, 'note.md'), project)).toBe(false);
	});
	it('checks hidden/protected paths before and after resolving links', () => {
		expect(isSafeWriteTarget('private-link/note.md', project)).toBe(false);
		expect(isSafeWriteTarget('.hidden-link/note.md', project)).toBe(false);
	});
	it('refuses broken links and loops instead of treating them as new folders', () => {
		for (const path of ['broken-link/note.md', 'loop/note.md']) {
			expect(resolveRestorationPath(path, project)).toBeUndefined();
			expect(isSafeWriteTarget(path, project)).toBe(false);
		}
	});
	it('refuses an existing file hard-linked to a file outside the project', () => {
		const source = join(outside, 'original.md');
		writeFileSync(source, 'synthetic outside data');
		linkSync(source, join(project, 'alias.md'));
		expect(isSafeWriteTarget('alias.md', project)).toBe(false);
	});
	it('does not turn permission or resolution errors into an allowed destination', () => {
		vi.mocked(lstatSync).mockImplementationOnce(() => {
			throw Object.assign(new Error('synthetic'), { code: 'EACCES' });
		});
		expect(isSafeWriteTarget('deals/note.md', project)).toBe(false);
		vi.mocked(realpathSync).mockImplementationOnce(() => {
			throw Object.assign(new Error('synthetic'), { code: 'EIO' });
		});
		expect(isSafeWriteTarget('deals/note.md', project)).toBe(false);
	});
	it.each(['.env', '.env.local', 'deals/.env.production'])('keeps the existing env-file exception: %s', (path) =>
		expect(isSafeWriteTarget(path, project)).toBe(true)
	);
});

describe('local tools with a real project path containing spaces and Unicode', () => {
	it.each([
		['Read', { file_path: 'deals/\u27eacustomer_name_1\u27eb.md' }],
		['Glob', { path: 'deals/\u27eacustomer_name_1\u27eb', pattern: '*.md' }],
		['Grep', { path: 'deals', pattern: '\u27eacustomer_name_1\u27eb' }],
		['Write', { file_path: 'deals/note.md', content: '\u27eacustomer_name_1\u27eb' }],
		['Edit', { file_path: 'deals/note.md', old_string: 'old', new_string: '\u27eacustomer_name_1\u27eb' }],
		[
			'MultiEdit',
			{ file_path: 'deals/note.md', edits: [{ old_string: 'old', new_string: '\u27eacustomer_name_1\u27eb' }] }
		],
		['NotebookEdit', { notebook_path: 'deals/note.ipynb', new_source: '\u27eacustomer_name_1\u27eb' }]
	] as const)('restores %s without adding a permission decision', (tool, input) => {
		const result = restoreToolInput(tool, input, key(), project, local);
		expect(result).toMatchObject({ kind: 'restored', confirm: false, count: 1 });
		if (result.kind === 'restored') expect(JSON.stringify(result.input)).toContain('Northwind');
	});
	it.each(['Bash', 'PowerShell', 'SomeFutureShell', 'mcp__example__send'])(
		'keeps the default no-restoration rule for %s',
		(tool) => {
			expect(restoreToolInput(tool, { command: '\u27eacustomer_name_1\u27eb' }, key(), project, local)).toEqual({
				kind: 'none'
			});
		}
	);
	it('refuses a restored write without a destination', () => {
		expect(restoreToolInput('Write', { content: '\u27eacustomer_name_1\u27eb' }, key(), project, local)).toMatchObject({
			kind: 'refused',
			reason: 'outside_project'
		});
	});
});

describe.skipIf(process.platform !== 'win32')('Windows filesystem restoration', () => {
	it.each(['LEFThook.YML', 'BUNFIG.TOML', '.GIT/config', 'deals\\..\\note.md'])(
		'refuses Windows protected/ambiguous spelling: %s',
		(path) => expect(isSafeWriteTarget(path, project)).toBe(false)
	);
	it('allows slash and drive-letter case variations', () => {
		expect(isSafeWriteTarget(join(project, 'deals', 'note.md').replaceAll('\\', '/'), project)).toBe(true);
		expect(
			isSafeWriteTarget(
				join(project, 'note.md').replace(/^[A-Z]/, (c) => c.toLowerCase()),
				project
			)
		).toBe(true);
		const otherDrive = parse(project).root[0]!.toUpperCase() === 'Z' ? 'Y' : 'Z';
		vi.clearAllMocks();
		expect(isSafeWriteTarget(`${otherDrive}:\\note.md`, project)).toBe(false);
		expect(
			restoreToolInput(
				'Write',
				{ file_path: `${otherDrive}:\\note.md`, content: '\u27eacustomer_name_1\u27eb' },
				key(),
				project,
				local
			)
		).toMatchObject({ kind: 'refused', reason: 'outside_project' });
		expect(
			restoreToolInput(
				'Write',
				{ file_path: '\u27eacustomer_name_1\u27eb', content: 'synthetic' },
				key(`${otherDrive}:\\note.md`),
				project,
				local
			)
		).toMatchObject({ kind: 'refused', reason: 'outside_project' });
		for (const call of filesystemCalls) expect(call).not.toHaveBeenCalled();
	});

	const filesystemCalls = [lstatSync, realpathSync, readlinkSync, statSync, existsSync, readFileSync, readdirSync];
	it.each(['\\\\server\\share\\note.md', '\\\\?\\C:\\note.md', 'C:note.md', '\\note.md', 'NUL.txt', 'note.md:stream'])(
		'refuses %s before spelling probes or Edit content reads',
		(path) => {
			vi.clearAllMocks();
			expect(
				restoreToolInput('Edit', { file_path: path, old_string: '\u27eacustomer_name_1\u27eb' }, key(), project, local)
			).toMatchObject({ kind: 'refused', reason: 'unsupported_path' });
			for (const call of filesystemCalls) expect(call).not.toHaveBeenCalled();
		}
	);
	it('refuses an unsupported cwd and a namespace supplied through a placeholder without probing', () => {
		vi.clearAllMocks();
		expect(
			restoreToolInput(
				'Write',
				{ file_path: 'note.md', content: '\u27eacustomer_name_1\u27eb' },
				key(),
				'\\\\server\\share',
				local
			)
		).toMatchObject({ kind: 'refused', reason: 'unsupported_path' });
		expect(
			restoreToolInput('Grep', { pattern: '\u27eacustomer_name_1\u27eb' }, key(), '\\\\server\\share', local)
		).toMatchObject({ kind: 'refused', reason: 'unsupported_path' });
		expect(
			restoreToolInput(
				'Read',
				{ file_path: '\u27eacustomer_name_1\u27eb' },
				key('\\\\server\\share\\note.md'),
				project,
				local
			)
		).toMatchObject({ kind: 'refused', reason: 'unsupported_path' });
		for (const call of filesystemCalls) expect(call).not.toHaveBeenCalled();
	});
	it('checks a link destination before accessing a namespace or ambiguous parent path', () => {
		for (const destination of ['\\\\synthetic-invalid-host\\share', '..\\project-sibling']) {
			vi.clearAllMocks();
			vi.mocked(readlinkSync).mockReturnValueOnce(destination);
			expect(resolveRestorationPath('inside-link/note.md', project)).toBeUndefined();
			for (const [path] of vi.mocked(lstatSync).mock.calls) {
				expect(String(path)).not.toMatch(/^\\\\/);
				expect(String(path)).not.toContain('project-sibling');
			}
		}
	});
});
