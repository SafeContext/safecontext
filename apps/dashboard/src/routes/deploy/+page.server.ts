import { managedSettings } from '@safecontext/policy';
import { latestPolicy } from '#lib/server/agent-api/policy.ts';
import { currentOrganization } from '#lib/server/current-org.ts';
import type { PageServerLoad } from './$types';

/** The managed settings for the published policy's fail mode (#25). */
export const load: PageServerLoad = async ({ url }) => {
	const org = currentOrganization();
	const policy = await latestPolicy(org.id);
	if (!policy) return { published: null };
	const json = (forceRefresh: boolean) =>
		JSON.stringify(managedSettings({ failMode: policy.failMode, forceRefresh }), null, 2);
	return {
		published: { version: policy.version, failMode: policy.failMode },
		settings: json(false),
		settingsWithRefresh: json(true),
		// For the agent's MDM profile (#26): this dashboard's address, as the browser reached it.
		organizationName: org.name,
		dashboardUrl: url.origin
	};
};
