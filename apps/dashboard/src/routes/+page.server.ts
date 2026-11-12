import { STATS_WINDOW_MS } from '#lib/feed.ts';
import { currentOrganization } from '#lib/server/current-org.ts';
import {
	dailyCounts,
	policyRollout,
	protectedByType,
	recentEvents,
	statsSince
} from '#lib/server/overview.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async () => {
	const org = currentOrganization();
	const asOf = new Date();
	const since = new Date(asOf.getTime() - STATS_WINDOW_MS);
	const [stats, events, days, types, rollout] = await Promise.all([
		statsSince(org.id, since),
		recentEvents(org.id),
		dailyCounts(org.id, asOf),
		protectedByType(org.id, since),
		policyRollout(org.id)
	]);
	return {
		asOf: asOf.toISOString(),
		since: since.toISOString(),
		stats,
		events,
		days,
		types,
		rollout
	};
};
