/**
 * The `safecontext` command on this device (installed by #26; in the repo:
 * `pnpm --filter @safecontext/agent exec tsx src/cli.ts <command>`).
 *
 *   safecontext doctor     Is everything in place? Says how to fix what isn't.
 *   safecontext swaps ...  The local swap record (#85): when Safe Context hid something from Claude
 *                          or put a real value back for a tool, with the placeholder, session, tool
 *                          and file. Never real values: the record doesn't hold them.
 *   safecontext version
 *
 * `safecontext run` (the agent itself) is handled by the installed wrapper script.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { formatDoctor, runDoctor } from './install/doctor.ts';
import { loadSettings } from './install/settings.ts';
import { defaultStateDir } from './sync/config.ts';
import { readSwapLog, type SwapRecord } from './swaps/swap-log.ts';

export interface SwapsOptions {
	session?: string;
	/** Only records newer than this many ms ago. */
	sinceMs?: number;
	limit: number;
	json: boolean;
}

const USAGE = `Usage: safecontext <command>

  doctor     Check that Safe Context is set up and working on this Mac
  swaps      Show what Safe Context hid from Claude, and where it put real values back
             [--session <id>] [--since <30m|2h|7d>] [--limit <n>] [--json]
             Lists placeholders, never the real values.
  version    Show the installed version`;

/** `30m`, `2h`, `7d` → ms. */
export function parseDuration(text: string): number | undefined {
	const m = /^(\d{1,6})([mhd])$/.exec(text.trim());
	if (!m) return undefined;
	return Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2] as 'm' | 'h' | 'd'];
}

export function parseSwapsArgs(args: string[]): SwapsOptions | string {
	const options: SwapsOptions = { limit: 50, json: false };
	for (let i = 0; i < args.length; i++) {
		const arg = args[i]!;
		const value = () => args[++i];
		if (arg === '--') continue; // pnpm passes its separator through
		if (arg === '--json') options.json = true;
		else if (arg === '--session') {
			const v = value();
			if (!v) return USAGE;
			options.session = v;
		} else if (arg === '--since') {
			const ms = parseDuration(value() ?? '');
			if (ms === undefined) return USAGE;
			options.sinceMs = ms;
		} else if (arg === '--limit') {
			const n = Number(value());
			if (!Number.isInteger(n) || n < 1) return USAGE;
			options.limit = n;
		} else return USAGE;
	}
	return options;
}

/** The records to show, newest last. A session matches by its start, as people copy short ids. */
export function selectSwaps(records: SwapRecord[], options: SwapsOptions, now = Date.now()): SwapRecord[] {
	return records
		.filter((r) => options.session === undefined || r.session.startsWith(options.session))
		.filter((r) => options.sinceMs === undefined || now - Date.parse(r.ts) <= options.sinceMs)
		.slice(-options.limit);
}

export function formatSwaps(records: SwapRecord[]): string {
	if (records.length === 0) return 'No swaps recorded.';
	const time = new Intl.DateTimeFormat('en-GB', { dateStyle: 'short', timeStyle: 'medium' });
	const rows = records.map((r) => [
		time.format(new Date(r.ts)),
		r.session.slice(0, 8),
		r.action === 'hidden' ? 'hidden' : 'put back',
		r.tool ?? (r.hook === 'UserPromptSubmit' ? 'prompt' : ''),
		r.placeholders.map((p) => `⟪${p}⟫`).join(' '),
		r.path ?? ''
	]);
	const head = ['Time', 'Session', 'Action', 'Tool', 'Placeholders', 'File'];
	const widths = head.map((h, c) => Math.max(h.length, ...rows.map((row) => [...row[c]!].length)));
	const line = (cells: string[]) =>
		cells
			.map((cell, c) => (c === cells.length - 1 ? cell : cell + ' '.repeat(widths[c]! - [...cell].length)))
			.join('  ')
			.trimEnd();
	return [line(head), ...rows.map(line)].join('\n');
}

export function runCli(args: string[], stateDir: string, out: (text: string) => void): number {
	const [command, ...rest] = args;
	if (command !== 'swaps') {
		out(USAGE);
		return command === undefined || command === '--help' ? 0 : 2;
	}
	const options = parseSwapsArgs(rest);
	if (typeof options === 'string') {
		out(options);
		return 2;
	}
	const records = selectSwaps(readSwapLog(stateDir), options);
	out(options.json ? JSON.stringify(records, null, 2) : formatSwaps(records));
	return 0;
}

/** `safecontext doctor`: exit 1 when something must be fixed. */
export async function doctorCommand(out: (text: string) => void): Promise<number> {
	const settings = loadSettings();
	const checks = await runDoctor({
		env: settings.env,
		source: settings.source,
		fetch,
		run: (file, args) =>
			new Promise((resolve) =>
				execFile(file, args, { timeout: 5_000 }, (err, stdout) => resolve(err ? undefined : String(stdout)))
			),
		exists: existsSync,
		readText: (path) => {
			try {
				return readFileSync(path, 'utf8');
			} catch {
				return undefined;
			}
		},
		uid: process.getuid?.() ?? 0,
		home: homedir()
	});
	out(formatDoctor(checks));
	return checks.some((c) => c.status === 'fail') ? 1 : 0;
}

if (import.meta.main) {
	const [command] = process.argv.slice(2);
	const out = (text: string) => console.log(text);
	if (command === 'doctor') {
		process.exitCode = await doctorCommand(out);
	} else if (command === 'version') {
		out(process.env['SC_VERSION'] ?? 'development');
	} else {
		const stateDir = loadSettings().env['SC_STATE_DIR']?.trim() || defaultStateDir();
		process.exitCode = runCli(process.argv.slice(2), stateDir, out);
	}
}
