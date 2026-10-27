// What the Overview page shows about events (issue #24). Shared by the server and the browser.
//
// METADATA ONLY. A feed event is built field by field from an Event row or an EventNotification,
// and `FeedEvent` is strict, so nothing else (and never any prompt, file or tool text) can reach
// the browser through it.
import { HookEventName } from '@safecontext/policy';
import * as z from 'zod';

/** How long the stat cards look back. */
export const STATS_WINDOW_MS = 7 * 24 * 3600 * 1000;

/** How many rows the feed shows. */
export const FEED_LIMIT = 50;

/**
 * The outcome of one check, shown as a pill and counted on the stat cards:
 * - `blocked`: the agent blocked the prompt or tool call.
 * - `vague`: not blocked, but something was changed (generalized, pseudonymized, masked or
 *   withheld from the output).
 * - `safe`: nothing needed changing.
 */
export const EventResult = z.enum(['safe', 'vague', 'blocked']);
export type EventResult = z.infer<typeof EventResult>;

export const FeedEvent = z.strictObject({
	/** `Event.id`. */
	id: z.uuid(),
	/** When the agent made the check. */
	ts: z.iso.datetime(),
	/** When the dashboard stored it. */
	receivedAt: z.iso.datetime(),
	hookEvent: HookEventName,
	/** Claude Code tool name, e.g. "Read". Null for prompts. */
	toolName: z.string().nullable(),
	/** The agent's anonymised device id. */
	deviceId: z.string(),
	result: EventResult
});
export type FeedEvent = z.infer<typeof FeedEvent>;

export type OverviewStats = { checked: number } & Record<EventResult, number>;

export const emptyStats = (): OverviewStats => ({ checked: 0, safe: 0, vague: 0, blocked: 0 });

/** Spans handled per action, as stored on an Event and sent in its notification. */
export type ActionCounts = {
	generalize: number;
	pseudonymize: number;
	mask: number;
	block: number;
};

export function eventResult(blocked: boolean, actions: ActionCounts): EventResult {
	if (blocked) return 'blocked';
	const changed = actions.generalize + actions.pseudonymize + actions.mask + actions.block;
	return changed > 0 ? 'vague' : 'safe';
}

/** Adds events to stat totals (returns a new object). */
export function addToStats(stats: OverviewStats, events: readonly FeedEvent[]): OverviewStats {
	const next = { ...stats };
	for (const e of events) {
		next.checked++;
		next[e.result]++;
	}
	return next;
}

/** Newest first (by when the check happened), without duplicates, at most `limit` rows. */
export function mergeFeed(
	a: readonly FeedEvent[],
	b: readonly FeedEvent[],
	limit = FEED_LIMIT
): FeedEvent[] {
	const byId = new Map<string, FeedEvent>();
	for (const e of [...a, ...b]) byId.set(e.id, e);
	return [...byId.values()]
		.sort((x, y) => y.ts.localeCompare(x.ts) || y.id.localeCompare(x.id))
		.slice(0, limit);
}

/** "Prompt" for prompt checks, otherwise the tool's name. */
export function toolLabel(e: Pick<FeedEvent, 'hookEvent' | 'toolName'>): string {
	return e.hookEvent === 'UserPromptSubmit' ? 'Prompt' : (e.toolName ?? 'Tool');
}

const STAGES: Record<HookEventName, string> = {
	UserPromptSubmit: 'Prompt check',
	PreToolUse: 'Before the tool ran',
	PostToolUse: 'Tool output'
};

export const stageLabel = (hookEvent: HookEventName): string => STAGES[hookEvent];

export const RESULT_LABELS: Record<EventResult, string> = {
	safe: 'Safe to share',
	vague: 'Made vague',
	blocked: 'Blocked'
};

/** Short relative time, e.g. "just now", "4 min ago", "3 h ago", "2 d ago". */
export function timeAgo(iso: string, now: number): string {
	const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
	if (s < 10) return 'just now';
	if (s < 60) return `${s} s ago`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.floor(m / 60);
	if (h < 24) return `${h} h ago`;
	return `${Math.floor(h / 24)} d ago`;
}
