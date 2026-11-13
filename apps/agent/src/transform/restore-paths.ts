/** Path checks for local placeholder restoration, not a filesystem sandbox (issue #93). */
import { lstatSync, readlinkSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path';

const WINDOWS = process.platform === 'win32';
const PROTECTED_FILES = new Set([
	'lefthook.yml',
	'lefthook.yaml',
	'bunfig.toml',
	'gradle-wrapper.properties',
	'maven-wrapper.properties',
	'pyrightconfig.json'
]);
const ENV_FILE = /^\.env(?:\.[A-Za-z0-9_-]+)*$/;

/** Pure validation, before any filesystem call. No UNC, device namespace, stream or DOS aliases. */
export function ordinaryWindowsPath(path: string): boolean {
	if (!path) return false;
	const rest = /^[A-Za-z]:[\\/]/.test(path) ? path.slice(3) : path;
	if (/^[\\/]|^[A-Za-z]:/.test(rest)) return false;
	if (/[<>:"|?*]/.test(rest) || [...rest].some((char) => char.charCodeAt(0) < 32)) return false;
	return rest.split(/[\\/]/).every((part) => {
		if (part === '.' || part === '..' || part === '') return true;
		const stem = part.split('.')[0]!.trim();
		return (
			!/[. ]$/.test(part) &&
			!/^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])$/i.test(stem) &&
			!/^[^~]{1,6}~[0-9]+(?:\.|$)/.test(part)
		);
	});
}

export function supportedRestorationPath(path: string, cwd: string): boolean {
	return (
		isAbsolute(cwd) &&
		path.length > 0 &&
		!path.includes('\0') &&
		(!WINDOWS || (ordinaryWindowsPath(cwd) && ordinaryWindowsPath(path)))
	);
}

/** Lexical only: a restored write cannot belong to a project on a different drive. */
export function sameWindowsDrive(path: string, cwd: string): boolean {
	return (
		win32.parse(win32.resolve(cwd, path)).root.toLowerCase() === win32.parse(win32.resolve(cwd)).root.toLowerCase()
	);
}

/**
 * Walk existing components, checking a link's destination before following it. Missing normal
 * components are allowed for a new file. Broken links, loops and errors never become a fallback
 * unresolved path. Another process can still change links between this check and the tool call.
 */
export function resolveRestorationPath(path: string, cwd: string): string | undefined {
	if (!supportedRestorationPath(path, cwd)) return undefined;
	const absolute = resolve(cwd, path);
	let current = parse(absolute).root;
	let pending = absolute
		.slice(current.length)
		.split(sep)
		.filter(Boolean)
		.map((part) => ({ part, required: false }));
	let links = 0;
	while (pending.length > 0) {
		const component = pending.shift()!;
		const next = join(current, component.part);
		let entry;
		try {
			entry = lstatSync(next);
		} catch (error) {
			return !component.required && (error as NodeJS.ErrnoException).code === 'ENOENT'
				? join(next, ...pending.map((item) => item.part))
				: undefined;
		}
		try {
			if (entry.isSymbolicLink()) {
				if (++links > 40) return undefined;
				const destination = readlinkSync(next);
				if (WINDOWS && (!ordinaryWindowsPath(destination) || destination.split(/[\\/]/).includes('..'))) {
					return undefined;
				}
				const target = resolve(dirname(next), destination);
				// Restart the walk for the target, so chains are inspected before realpath follows them.
				current = parse(target).root;
				pending = [
					...target
						.slice(current.length)
						.split(sep)
						.filter(Boolean)
						.map((part) => ({ part, required: true })),
					...pending
				];
				continue;
			}
			if (pending.length > 0 && !entry.isDirectory()) return undefined;
			current = realpathSync(next);
			if (WINDOWS && !ordinaryWindowsPath(current)) return undefined;
		} catch {
			return undefined;
		}
	}
	return current;
}

function protectedRelative(path: string): boolean {
	const parts = path.split(sep);
	const name = WINDOWS ? parts.at(-1)!.toLowerCase() : parts.at(-1)!;
	return (
		parts.slice(0, -1).some((part) => part.startsWith('.')) ||
		(name.startsWith('.') && !ENV_FILE.test(name)) ||
		PROTECTED_FILES.has(name)
	);
}

function inside(path: string): boolean {
	return path !== '' && path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path);
}

/** Restore writes only to an established project, through an ordinary, unprotected target. */
export function isSafeWriteTarget(path: string, cwd: string): boolean {
	if (!supportedRestorationPath(path, cwd)) return false;
	if (WINDOWS && !sameWindowsDrive(path, cwd)) return false;
	// Avoid a link/.. spelling being interpreted differently by the eventual tool.
	if (WINDOWS && path.split(/[\\/]/).includes('..')) return false;
	const root = resolveRestorationPath(cwd, cwd);
	if (!root) return false;
	try {
		if (!statSync(root).isDirectory()) return false;
	} catch {
		return false;
	}
	const target = resolveRestorationPath(path, cwd);
	if (!target) return false;
	try {
		// Existing hard-linked files can alias a protected file or another project.
		const entry = lstatSync(target, { throwIfNoEntry: false });
		if (entry && !entry.isDirectory() && entry.nlink > 1) return false;
	} catch {
		return false;
	}
	const canonical = relative(root, target);
	const lexical = relative(resolve(cwd), resolve(cwd, path));
	return inside(canonical) && !protectedRelative(canonical) && !(inside(lexical) && protectedRelative(lexical));
}
