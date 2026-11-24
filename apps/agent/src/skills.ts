/**
 * Skills and slash commands (#42). When a skill runs, its text (and the output of any
 * `` !`cmd` `` lines in it) reaches Claude without passing a tool hook, so the agent reads the
 * skill's own file and checks it first. Locations: https://code.claude.com/docs/en/skills.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

/**
 * Larger skill files aren't read: a skill is instructions, not data, and checking only part of
 * one would let the rest through. `readSkill` throws, so the fail mode applies (PR #130 review).
 */
export const MAX_SKILL_BYTES = 1024 * 1024;
/** How long a listing of plugin folders is reused (the walk is synchronous; PR #130 review). */
const PLUGIN_CACHE_MS = 30_000;
const pluginCache = new Map<string, { at: number; dirs: string[] }>();

/**
 * The files that may hold the skill or command `name`, that exist: `.claude/skills/<name>/SKILL.md`
 * and `.claude/commands/<name>.md` in `cwd`, its parent folders and the home folder; for
 * `plugin:skill`, the plugin's `skills/<skill>/SKILL.md` or `commands/<skill>.md` under
 * `~/.claude/plugins`, and `.claude/commands/plugin/skill.md` (a command in a subfolder).
 */
export function skillFiles(name: string, cwd: string, home = homedir()): string[] {
	if (!/^[\w.:-]{1,200}$/.test(name) || name.includes('..')) return [];
	const found = new Set<string>();
	const add = (path: string) => existsSync(path) && statSync(path).isFile() && found.add(path);
	const roots: string[] = [];
	for (let dir = resolve(cwd); ; dir = dirname(dir)) {
		roots.push(dir);
		if (dirname(dir) === dir) break;
	}
	if (!roots.includes(home)) roots.push(home);
	for (const root of roots) {
		add(join(root, '.claude', 'skills', name, 'SKILL.md'));
		add(join(root, '.claude', 'commands', `${name.replaceAll(':', '/')}.md`));
	}
	const [plugin, skill] = name.split(':', 2);
	if (plugin && skill) {
		for (const dir of cachedPluginDirs(join(home, '.claude', 'plugins'), plugin)) {
			add(join(dir, 'skills', skill, 'SKILL.md'));
			add(join(dir, 'commands', `${skill}.md`));
		}
	}
	return [...found];
}

function cachedPluginDirs(root: string, name: string): string[] {
	const key = `${root}\0${name}`;
	const hit = pluginCache.get(key);
	if (hit && Date.now() - hit.at < PLUGIN_CACHE_MS) return hit.dirs;
	const dirs = pluginDirs(root, name, 6);
	pluginCache.set(key, { at: Date.now(), dirs });
	return dirs;
}

/** Folders named `name` under `root`, at most `depth` levels down (plugin caches and marketplaces). */
function pluginDirs(root: string, name: string, depth: number): string[] {
	const out: string[] = [];
	const walk = (dir: string, left: number) => {
		let entries;
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const e of entries) {
			if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
			const path = join(dir, e.name);
			if (e.name === name) out.push(path);
			if (left > 0) walk(path, left - 1);
		}
		// A plugin's own folder can sit under a version folder (`<plugin>/<version>/skills`).
		if (dir.endsWith(`/${name}`)) for (const e of entries) if (e.isDirectory()) out.push(join(dir, e.name));
	};
	walk(root, depth);
	return out;
}

/** The skill's text, from all its files. Throws if one is larger than `MAX_SKILL_BYTES`. */
export function readSkill(files: readonly string[]): string {
	return files
		.map((f) => {
			if (statSync(f).size > MAX_SKILL_BYTES) throw new Error('skill_too_large');
			return readFileSync(f, 'utf8');
		})
		.join('\n\n');
}

/**
 * Does the skill inject shell output (`` !`cmd` `` at a line start or after a space, or a
 * ` ```! ` block)? That output reaches Claude unchecked, so it can't be checked in advance.
 */
export function injectsShell(text: string): boolean {
	return /(^|\s)!`[^`\n]+`/m.test(text) || /^\s*```!/m.test(text);
}

/** Safe Context's own skills that run a command: `/safe-context:status` prints the agent's health. */
const OWN_SHELL_SKILLS = ['safe-context:status'];

/** Is `name` allowed to inject shell output: on the policy's list, or one of Safe Context's own? */
export function shellAllowed(list: readonly string[], name: string): boolean {
	const n = name.toLowerCase().replace(/^\//, '');
	return [...OWN_SHELL_SKILLS, ...list].some((s) => s.trim().toLowerCase().replace(/^\//, '') === n);
}
