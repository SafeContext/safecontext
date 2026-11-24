/**
 * Swap-back: put the real values behind placeholders into a tool's input just before it runs
 * (SPEC.md §4, issue #83). Claude writes `⟪customer_name_1⟫`, the file on disk gets "Northwind",
 * and Claude never sees the value: Claude Code keeps Claude's own version of the call in the
 * conversation, and PostToolUse hides the value again in what the tool returns.
 *
 * Which tools: the policy's `swapBack.tools` (packages/policy). By default the local file tools,
 * which run on this Mac without a model: Read, Write, Edit, MultiEdit, NotebookEdit, Glob, Grep.
 * Every other tool gets the placeholder exactly as Claude wrote it, unless IT adds it:
 * - Bash: in auto mode its safety check is a model call to Anthropic and it sees the changed
 *   command (tested on Claude Code 2.1.302); a command can also send data off the Mac.
 * - MCP tools: they send their input off the Mac.
 * A tool IT adds gets `confirm`: the hook answers `ask`, so the user sees the real values and
 * approves the call, and auto mode's check never sees it (tested for Bash). A Bash call that
 * asks to run outside the sandbox is refused: auto mode checks those even when the hook asks.
 * Agent, Task, WebFetch and WebSearch never get real values: their input goes to an Anthropic
 * model (`NEVER_SWAP_BACK_TOOLS`).
 *
 * Writes (Write, Edit, MultiEdit, NotebookEdit) get real values only inside the project folder
 * (the hook's `cwd`, symlinks resolved), and not inside a hidden folder or into a hidden file
 * other than `.env` files. In auto mode Claude Code sends writes outside the working directory,
 * and to protected paths such as `.git`, `.claude` and `.bashrc`, to its safety check, which
 * would see the real values. Claude Code's protected list is long and can grow, so this rule
 * is broader than the list rather than a copy of it, and it applies in every permission mode.
 *
 * A placeholder the key doesn't hold (the agent restarted, the session is too old, or Claude
 * made one up) stops a swap-back tool: running it would read the wrong file or write the
 * placeholder into a file as if it were the value.
 *
 * One placeholder can stand for several spellings ("Northwind" in a document, "northwind" in a
 * file name). A path gets the spelling that exists on disk, and an Edit's `old_string` the one the
 * file holds, so both still match exactly. Anything else gets the spelling that fits where the
 * placeholder sits (`preferredSpellings`, #108): the word list's own spelling in running text,
 * the lowercase one inside a file name or slug.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { swapsBackInto } from '@safecontext/policy';
import { OPEN, PLACEHOLDER, type SessionKey } from './placeholders.ts';

interface RestoreTool {
	/** Input fields holding a path. */
	paths: readonly string[];
	/** True if the tool changes the file at its path. */
	writes: boolean;
	/** Input fields that are regular expressions: values are escaped, so they match literally. */
	regex?: readonly string[];
}

/** The local file tools: what their fields mean. Any other tool IT adds is treated as `OTHER_TOOL`. */
export const RESTORE_TOOLS: Readonly<Record<string, RestoreTool>> = {
	Read: { paths: ['file_path'], writes: false },
	Glob: { paths: ['path'], writes: false },
	Grep: { paths: ['path'], writes: false, regex: ['pattern'] },
	Write: { paths: ['file_path'], writes: true },
	Edit: { paths: ['file_path'], writes: true },
	MultiEdit: { paths: ['file_path'], writes: true },
	NotebookEdit: { paths: ['notebook_path'], writes: true }
};
const OTHER_TOOL: RestoreTool = { paths: [], writes: false };

/** Files outside hidden folders that Claude Code protects too (docs: permission modes, protected paths). */
const PROTECTED_FILES = new Set([
	'lefthook.yml',
	'lefthook.yaml',
	'bunfig.toml',
	'gradle-wrapper.properties',
	'maven-wrapper.properties',
	'pyrightconfig.json'
]);

/** `.env`, `.env.local`, `.env.production`, …: hidden files where real values belong. */
const ENV_FILE = /^\.env(?:\.[A-Za-z0-9_-]+)*$/;

export type Restored =
	/** No placeholder to put back, or a tool that never gets real values. */
	| { kind: 'none' }
	/** `confirm`: not a local file tool, so the user approves the call first (the hook answers `ask`). */
	| { kind: 'restored'; input: Record<string, unknown>; count: number; confirm: boolean }
	| { kind: 'refused'; reason: 'unknown_placeholder' | 'outside_project' | 'sandbox_escape'; ids: string[] };

export function restoreToolInput(
	toolName: string,
	input: Record<string, unknown>,
	key: SessionKey,
	cwd: string,
	/** The policy's `swapBack.tools`. */
	tools: readonly string[],
	/** The word-list spelling of a value, matched ignoring case (the policy's term lists). */
	canonical: (value: string) => string | undefined = () => undefined
): Restored {
	if (!swapsBackInto(tools, toolName) || !JSON.stringify(input).includes(OPEN)) return { kind: 'none' };
	const local = RESTORE_TOOLS[toolName];
	const tool = local ?? OTHER_TOOL;

	let count = 0;
	const unknown = new Set<string>();

	/**
	 * `text` with each placeholder swapped for a spelling of its value. A value can have several
	 * spellings ("Northwind", "northwind"); the combination with the highest `score` wins, the first
	 * spellings seen on a tie.
	 */
	const swap = (text: string, score: (candidate: string) => number, escape: (v: string) => string) => {
		if (!text.includes(OPEN)) return text;
		const found = [...text.matchAll(PLACEHOLDER)];
		const options = found.map((m) => {
			const seen = key.spellingsOf(m[1]!);
			return seen.length ? preferredSpellings(seen, inSlug(text, m.index, m.index + m[0].length), canonical) : seen;
		});
		found.forEach((m, i) => options[i]!.length === 0 && unknown.add(m[1]!));
		if (found.length === 0 || options.some((o) => o.length === 0)) return text;
		count += found.length;
		const single = options.every((o) => o.length === 1);
		let best: { out: string; score: number } | undefined;
		for (const choice of combinations(options, MAX_CANDIDATES)) {
			let out = '';
			let pos = 0;
			found.forEach((m, i) => {
				out += text.slice(pos, m.index) + escape(choice[i]!);
				pos = m.index + m[0].length;
			});
			out += text.slice(pos);
			if (single) return out;
			const points = score(out);
			if (!best || points > best.score) best = { out, score: points };
			if (points >= PERFECT) break;
		}
		return best!.out;
	};
	const plain = (v: string) => v;
	const none = () => 0;

	// Paths first. Best: the path exists with exactly these letters; next: its folder does (a new file).
	const restored: Record<string, unknown> = { ...input };
	for (const field of tool.paths) {
		const v = input[field];
		if (typeof v === 'string') {
			restored[field] = swap(v, (c) => pathScore(resolve(cwd, c)), plain);
		}
	}
	// An Edit's old_string is right when the file holds it.
	let fileText: string | null | undefined;
	const holds = (c: string) => {
		if (fileText === undefined) fileText = readSmallFile(restored[tool.paths[0]!], cwd);
		return fileText !== null && fileText.includes(c) ? PERFECT : 0;
	};
	const walk = (v: unknown, field: string): unknown => {
		if (typeof v === 'string') {
			if (tool.regex?.includes(field)) return swap(v, none, escapeRegex);
			return swap(v, field === 'old_string' ? holds : none, plain);
		}
		if (Array.isArray(v)) return v.map((x) => walk(x, field));
		if (v !== null && typeof v === 'object') {
			return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
		}
		return v;
	};
	for (const [field, v] of Object.entries(input)) {
		if (!tool.paths.includes(field)) restored[field] = walk(v, field);
	}

	if (unknown.size > 0) return { kind: 'refused', reason: 'unknown_placeholder', ids: [...unknown] };
	if (count === 0) return { kind: 'none' };
	if (toolName === 'Bash' && input['dangerouslyDisableSandbox'] === true) {
		return { kind: 'refused', reason: 'sandbox_escape', ids: [] };
	}
	if (tool.writes) {
		for (const field of tool.paths) {
			const target = restored[field];
			if (typeof target === 'string' && !isSafeWriteTarget(target, cwd)) {
				return { kind: 'refused', reason: 'outside_project', ids: [] };
			}
		}
	}
	return { kind: 'restored', input: restored, count, confirm: local === undefined };
}

/**
 * Is the placeholder at `[start, end)` part of a file name or path, such as
 * "inbox/⟪x⟫-email.md" or "/deals/⟪x⟫"? Then a lowercase spelling fits better than a capitalised
 * one. The word around it (up to the nearest spaces, quotes and brackets trimmed) must end in a
 * file extension or start like a path, so prose such as "⟪x⟫-based pricing" or "the ⟪x⟫/⟪y⟫
 * merger" isn't mistaken for one.
 */
export function inSlug(text: string, start: number, end: number): boolean {
	let a = start;
	while (a > 0 && !/\s/.test(text[a - 1]!)) a--;
	let b = end;
	while (b < text.length && !/\s/.test(text[b]!)) b++;
	const word = text
		.slice(a, b)
		.replace(/^[("'`<[]+/, '')
		.replace(/[)"'`>\],;:!?]+$/, '')
		.replace(/\.$/, '');
	return /\.[A-Za-z][A-Za-z0-9]{0,5}$/.test(word) || /^(?:\/|\.{1,2}\/|~\/)/.test(word);
}

/**
 * A value's spellings, best first, for a placeholder in running text or (`slug`) in a file
 * name. Running text prefers the word list's spelling, even one never seen in this session,
 * then a spelling with a capital letter; a file name prefers an all-lowercase spelling. Ties keep
 * the order first seen.
 */
export function preferredSpellings(
	seen: readonly string[],
	slug: boolean,
	canonical: (value: string) => string | undefined = () => undefined
): string[] {
	const listed = seen.map((v) => canonical(v)).find((v) => v !== undefined);
	const all = listed !== undefined && !slug && !seen.includes(listed) ? [listed, ...seen] : [...seen];
	const rank = (v: string) => {
		const lower = v === v.toLowerCase();
		if (slug) return lower ? 0 : 1;
		if (v === listed) return 0;
		return lower ? 2 : 1;
	};
	return all
		.map((v, i) => ({ v, i }))
		.sort((a, b) => rank(a.v) - rank(b.v) || a.i - b.i)
		.map(({ v }) => v);
}

const PERFECT = 2;

/** 2: `path` exists, every part spelled exactly so (disks on a Mac usually ignore case); 1: its folder does; 0: neither. */
function pathScore(path: string): number {
	if (existsExactly(path)) return PERFECT;
	return existsExactly(dirname(path)) ? 1 : 0;
}

function existsExactly(path: string): boolean {
	if (!existsSync(path)) return false;
	for (let p = path; dirname(p) !== p; p = dirname(p)) {
		try {
			if (!readdirSync(dirname(p)).includes(basename(p))) return false;
		} catch {
			return false;
		}
	}
	return true;
}

/** Spelling combinations tried per field, at most. */
const MAX_CANDIDATES = 32;
/** Larger files aren't read to pick an Edit's spelling; the first spellings are used. */
const MAX_READ_BYTES = 10 * 1024 * 1024;

/** Every way to pick one option from each list, first options first, up to `max`. */
function* combinations(options: readonly (readonly string[])[], max: number): Generator<string[]> {
	const index = options.map(() => 0);
	for (let n = 0; n < max; n++) {
		yield index.map((i, k) => options[k]![i]!);
		let k = index.length - 1;
		while (k >= 0 && index[k] === options[k]!.length - 1) index[k--] = 0;
		if (k < 0) return;
		index[k]!++;
	}
}

function readSmallFile(path: unknown, cwd: string): string | null {
	if (typeof path !== 'string') return null;
	try {
		const full = resolve(cwd, path);
		return statSync(full).size <= MAX_READ_BYTES ? readFileSync(full, 'utf8') : null;
	} catch {
		return null;
	}
}

/** Inside `cwd` (symlinks resolved), with no hidden folder on the way and no protected file name. */
export function isSafeWriteTarget(path: string, cwd: string): boolean {
	if (!isAbsolute(cwd)) return false;
	const root = realpathOrSelf(cwd);
	const target = resolveExisting(resolve(cwd, path));
	const rel = relative(root, target);
	if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
	const parts = rel.split(sep);
	const name = parts.at(-1)!;
	if (parts.slice(0, -1).some((p) => p.startsWith('.'))) return false;
	if (name.startsWith('.') && !ENV_FILE.test(name)) return false;
	return !PROTECTED_FILES.has(name);
}

function realpathOrSelf(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** The path with symlinks resolved as far as it exists (a file Write creates doesn't exist yet). */
function resolveExisting(path: string): string {
	let head = path;
	const tail: string[] = [];
	for (;;) {
		try {
			return resolve(realpathSync(head), ...tail);
		} catch {
			const parent = dirname(head);
			if (parent === head) return path;
			tail.unshift(basename(head));
			head = parent;
		}
	}
}

/** For ripgrep's regex syntax: every value matches as plain text. */
function escapeRegex(value: string): string {
	return value.replace(/[\\^$.|?*+()[\]{}]/g, '\\$&');
}
