/**
 * Structured logs: one JSON object per line on stderr.
 *
 * NEVER log prompt, file or tool text, nor anything taken from a hook input that could hold it
 * (paths, session ids, commands, URLs). `LogFields` is a closed list of metadata fields on
 * purpose: adding a free-text field should need a deliberate change here.
 */
import type { HookEventName } from '@safecontext/policy';

export type LogLevel = 'info' | 'warn' | 'error';

export type LogMessage =
	'listening' | 'check' | 'invalid_input' | 'invalid_output' | 'handler_error' | 'policy_loaded' | 'policy_fallback';

/** How a check ended. `fail_*` means the policy's fail mode decided (SPEC.md §2a). */
export type Outcome = 'allow' | 'block' | 'fail_block' | 'fail_allow';

export interface LogFields {
	hook?: HookEventName;
	outcome?: Outcome;
	/** Why the fail mode applied. */
	failure?: 'error' | 'timeout' | 'unsupported_action' | 'invalid_input' | 'invalid_output';
	/** Claude Code tool name, e.g. "Read" or "mcp__slack__post". Metadata, not text. */
	tool?: string;
	/** Tier ids that ran, in order, e.g. "tier0". */
	tiers?: string[];
	policyVersion?: number;
	/** Where the policy came from. */
	policySource?: 'file' | 'default' | 'static';
	/** Why the policy file wasn't used. */
	policyError?: 'missing' | 'unreadable' | 'not_json' | 'invalid';
	/** Number of text fields checked. */
	fields?: number;
	/** Total characters checked (a size, not the text). */
	chars?: number;
	spans?: number;
	/** Zod issue count when a policy file or request fails validation. */
	issues?: number;
	/** Milliseconds. */
	classifyMs?: number;
	totalMs?: number;
	port?: number;
}

export interface Logger {
	log(level: LogLevel, msg: LogMessage, fields?: LogFields): void;
}

/** Writes JSON lines to stderr (stdout stays free for anything else). */
export function jsonLogger(write: (line: string) => void = (line) => process.stderr.write(line)): Logger {
	return {
		log(level, msg, fields = {}) {
			write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n');
		}
	};
}

export const silentLogger: Logger = { log() {} };

/** Keeps records in memory. For tests. */
export function memoryLogger(): Logger & { records: Array<{ level: LogLevel; msg: LogMessage } & LogFields> } {
	const records: Array<{ level: LogLevel; msg: LogMessage } & LogFields> = [];
	return {
		records,
		log(level, msg, fields = {}) {
			records.push({ level, msg, ...fields });
		}
	};
}
