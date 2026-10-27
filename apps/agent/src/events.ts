/**
 * What the agent records about each check: metadata only, never text. Shaped like `AgentEvent`
 * from @safecontext/policy minus `deviceId`, which the dashboard sync (issue #22) adds before
 * uploading. #22 provides a real `EventSink`; until then reports are dropped.
 */
import type { Action, AgentEvent } from '@safecontext/policy';
import type { Decision } from './decide.ts';

export type CheckReport = Omit<AgentEvent, 'deviceId'>;

export interface EventSink {
	/** Called once per hook request, after the response is built. Must not throw or block. */
	record(report: CheckReport): void;
}

export const noopEventSink: EventSink = { record() {} };

/** Counts per data type id and per action, from a decision's hits. */
export function countHits(decision: Decision): Pick<CheckReport, 'counts' | 'actions'> {
	const counts: Record<string, number> = {};
	const actions: Partial<Record<Action, number>> = {};
	for (const hit of decision.hits) {
		counts[hit.dataTypeId] = (counts[hit.dataTypeId] ?? 0) + hit.count;
		actions[hit.action] = (actions[hit.action] ?? 0) + hit.count;
	}
	return { counts, actions };
}
