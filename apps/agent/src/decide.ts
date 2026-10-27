/**
 * Turns detected spans into a verdict, using the policy. Detection (classifier/) knows nothing
 * about responses; the hook handlers (hooks.ts) turn the verdict into hook JSON.
 *
 * Issue #10 adds transformations here: mask, pseudonymize and generalize become a "rewrite"
 * verdict instead of falling back to the fail mode, and `block` spans in tool output are
 * removed rather than withholding the whole output.
 */
import type { Span } from '@safecontext/detectors';
import type { Action, FailMode, Policy } from '@safecontext/policy';
import type { ClassifyResult } from './classifier/types.ts';

/** A data type found in the text. Names are admin-written labels, safe to show; never span text. */
export interface Hit {
	dataTypeId: string;
	name: string;
	action: Action;
	count: number;
}

export type Failure = 'error' | 'timeout' | 'unsupported_action' | 'invalid_input' | 'invalid_output';

export type Decision =
	| { verdict: 'allow'; cause: 'clean'; hits: Hit[] }
	/** At least one span's data type has action `block`. */
	| { verdict: 'block'; cause: 'policy'; hits: Hit[] }
	/** Checking couldn't finish; the policy's fail mode picked the verdict (SPEC.md §2a). */
	| { verdict: FailMode; cause: 'fail'; failure: Failure; hits: Hit[] };

/**
 * Actions this build can carry out. The others need transformations (issue #10); until then
 * a span with one of them means "can't finish checking", so the fail mode applies.
 */
const SUPPORTED_ACTIONS: ReadonlySet<Action> = new Set<Action>(['allow', 'block']);

export function failDecision(policy: Policy, failure: Failure, hits: Hit[] = []): Decision {
	return { verdict: policy.failMode, cause: 'fail', failure, hits };
}

export function decide(result: ClassifyResult, policy: Policy): Decision {
	if (!result.ok) return failDecision(policy, result.failure);

	const hits = summarize(result.spans.flat(), policy);
	const acting = hits.filter((h) => h.action !== 'allow');
	if (acting.some((h) => h.action === 'block')) return { verdict: 'block', cause: 'policy', hits };
	if (acting.some((h) => !SUPPORTED_ACTIONS.has(h.action))) return failDecision(policy, 'unsupported_action', hits);
	return { verdict: 'allow', cause: 'clean', hits };
}

/**
 * Count spans per data type, in policy order. A span whose data type isn't in the policy (a
 * built-in detector type the admin removed) gets action `block`, so nothing found is let through
 * by accident. Unknown types sort last.
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
