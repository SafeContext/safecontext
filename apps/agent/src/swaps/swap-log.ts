/**
 * The local record of swaps (issue #85): when Safe Context hid something from Claude, or put a
 * real value back for a tool, which placeholder, in which session, tool and file. It never holds
 * a real value, and it never leaves this device (no logs or dashboard events). Read it with
 * `safecontext swaps` (cli.ts).
 *
 * One JSON object per line in `<state dir>/swaps.jsonl`, private to the user. When the file
 * passes `maxBytes` it becomes `swaps.1.jsonl` (replacing the older one) and a new file starts.
 */
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const SWAP_LOG_FILE = 'swaps.jsonl';
export const SWAP_LOG_OLD_FILE = 'swaps.1.jsonl';
export const DEFAULT_SWAP_LOG_BYTES = 5 * 1024 * 1024;

export interface SwapRecord {
	/** ISO time. */
	ts: string;
	/** Claude Code session id. */
	session: string;
	/** `hidden`: placeholders Claude was shown. `restored`: placeholders a tool got real values for. */
	action: 'hidden' | 'restored';
	/** Ids, no brackets or hints (`customer_name_1`). */
	placeholders: string[];
	hook: 'UserPromptSubmit' | 'PreToolUse' | 'PostToolUse';
	tool?: string;
	/** The file the tool read or wrote, when it names one. */
	path?: string;
}

export interface SwapLog {
	record(entry: SwapRecord): void;
}

export const noopSwapLog: SwapLog = { record() {} };

export function createSwapLog({
	dir,
	maxBytes = DEFAULT_SWAP_LOG_BYTES,
	onError = () => {}
}: {
	dir: string;
	maxBytes?: number;
	onError?: (code: 'swap_log_failed') => void;
}): SwapLog {
	const file = join(dir, SWAP_LOG_FILE);
	return {
		record(entry) {
			if (entry.placeholders.length === 0) return;
			try {
				mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
				try {
					if (statSync(file).size >= maxBytes) renameSync(file, join(dir, SWAP_LOG_OLD_FILE));
				} catch {
					// No file yet.
				}
				appendFileSync(file, JSON.stringify(entry) + '\n', { mode: 0o600 });
			} catch {
				onError('swap_log_failed');
			}
		}
	};
}

/** Every record in the log, oldest first (the rotated file first). Bad lines are skipped. */
export function readSwapLog(dir: string): SwapRecord[] {
	const out: SwapRecord[] = [];
	for (const name of [SWAP_LOG_OLD_FILE, SWAP_LOG_FILE]) {
		let text: string;
		try {
			text = readFileSync(join(dir, name), 'utf8');
		} catch {
			continue;
		}
		for (const line of text.split('\n')) {
			if (!line.trim()) continue;
			try {
				const r = JSON.parse(line) as SwapRecord;
				if (typeof r.ts === 'string' && typeof r.session === 'string' && Array.isArray(r.placeholders)) out.push(r);
			} catch {
				// A line cut short by a crash.
			}
		}
	}
	return out;
}
