import { defaultDetectors, detectAll, type Detector } from '@safecontext/detectors';
import type { Policy } from '@safecontext/policy';
import type { ClassifierTier } from './types.ts';

export interface Tier0Options {
	/**
	 * Extra detectors built from the policy. This is where the admin term-list matcher from
	 * issue #8 (PR #47) plugs in: `(policy) => [createTermListDetector(policy.lists)]`. Called once per
	 * policy object (the result is cached), so building an index here is fine.
	 */
	policyDetectors?: (policy: Policy) => readonly Detector[];
	/** Built-in rule detectors. Defaults to `defaultDetectors` from @safecontext/detectors. */
	detectors?: readonly Detector[];
}

/** Tier 0: deterministic rules + admin term lists (SPEC.md §4, target < 10 ms). */
export function createTier0({ policyDetectors, detectors = defaultDetectors }: Tier0Options = {}): ClassifierTier {
	const cache = new WeakMap<Policy, readonly Detector[]>();
	const detectorsFor = (policy: Policy): readonly Detector[] => {
		if (!policyDetectors) return detectors;
		let all = cache.get(policy);
		if (!all) {
			all = [...detectors, ...policyDetectors(policy)];
			cache.set(policy, all);
		}
		return all;
	};

	return {
		id: 'tier0',
		tier: 0,
		detect(texts, { policy }) {
			const all = detectorsFor(policy);
			return texts.map((text) => (text.length === 0 ? [] : detectAll(text, all)));
		}
	};
}
