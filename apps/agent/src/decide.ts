/**
 * Turns detected spans into a verdict, using the policy. Detection (classifier/) knows nothing
 * about responses; transform/ turns spans into safe text; the hook handlers (hooks.ts) turn the
 * verdict into hook JSON.
 *
 * Verdicts, per hook (`rewrite` vs `block` is decided by `stopsPromptsAndToolCalls`, issue #50):
 * | verdict | prompt                        | tool input | tool output                         |
 * | ------- | ----------------------------- | ---------- | ----------------------------------- |
 * | allow   | pass                          | pass       | pass                                |
 * | rewrite | pass                          | pass       | flagged spans transformed           |
 * | block   | blocked, reason has safe text | denied     | flagged spans transformed / removed |
 */
import type { Span } from '@safecontext/detectors';
import type { Action, FailMode, Policy, Tier } from '@safecontext/policy';
import type { ClassifyResult } from './classifier/types.ts';

/** A data type found in the text. Names are admin-written labels, safe to show; never span text. */
export interface Hit {
	dataTypeId: string;
	name: string;
	tier: Tier;
	action: Action;
	count: number;
}

export type Failure = 'error' | 'timeout' | 'invalid_input' | 'invalid_output';

export type Decision =
	| { verdict: 'allow'; cause: 'clean'; hits: Hit[] }
	/** Some spans need transforming; none stop a prompt or tool call. `spans` has one array per text. */
	| { verdict: 'rewrite'; cause: 'policy'; hits: Hit[]; spans: Span[][] }
	/** At least one span stops a prompt or tool call (`stopsPromptsAndToolCalls`). */
	| { verdict: 'block'; cause: 'policy'; hits: Hit[]; spans: Span[][] }
	/** Checking couldn't finish; the policy's fail mode picked the verdict (SPEC.md §2a). */
	| { verdict: FailMode; cause: 'fail'; failure: Failure; hits: Hit[] };

/**
 * THE RULE for which data stops a prompt or a tool call outright. Prompts and tool inputs
 * can't be edited, only blocked or let through, so this decides between the two.
 *
 * TEMPORARY (issue #50, needs a decision): only red data, or a data type whose action is `block`,
 * stops them. Yellow data (mask, pseudonymize, generalize) in a prompt or tool input goes through
 * unchanged. Tool output is always transformed span by span, whatever this returns.
 */
export function stopsPromptsAndToolCalls(hit: Pick<Hit, 'tier' | 'action'>): boolean {
	return hit.tier === 'red' || hit.action === 'block';
}

export function failDecision(policy: Policy, failure: Failure, hits: Hit[] = []): Decision {
	return { verdict: policy.failMode, cause: 'fail', failure, hits };
}

export function decide(result: ClassifyResult, policy: Policy): Decision {
	if (!result.ok) return failDecision(policy, result.failure);

	const hits = summarize(result.spans.flat(), policy);
	const acting = hits.filter((h) => h.action !== 'allow');
	if (acting.length === 0) return { verdict: 'allow', cause: 'clean', hits };
	const verdict = acting.some(stopsPromptsAndToolCalls) ? 'block' : 'rewrite';
	return { verdict, cause: 'policy', hits, spans: result.spans };
}

/**
 * Count spans per data type, in policy order. A span whose data type isn't in the policy (a
 * built-in detector type the admin removed) is treated as red with action `block`, so nothing
 * found is let through by accident. Unknown types sort last.
 */
export function summarize(spans: readonly Span[], policy: Policy): Hit[] {
	const byId = new Map<string, Hit>();
	for (const span of spans) {
		const hit = byId.get(span.dataTypeId);
		if (hit) hit.count++;
		else {
			const dt = policy.dataTypes.find((d) => d.id === span.dataTypeId);
			byId.set(span.dataTypeId, {
				dataTypeId: span.dataTypeId,
				name: dt?.name ?? span.dataTypeId,
				tier: dt?.tier ?? 'red',
				action: dt?.action ?? 'block',
				count: 1
			});
		}
	}
	const order = (id: string) => {
		const i = policy.dataTypes.findIndex((d) => d.id === id);
		return i === -1 ? Number.MAX_SAFE_INTEGER : i;
	};
	return [...byId.values()].sort((a, b) => order(a.dataTypeId) - order(b.dataTypeId));
}
