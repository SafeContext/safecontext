import { latestPolicy } from '#lib/server/agent-api/policy.ts';
import { currentOrganization } from '#lib/server/current-org.ts';
import { LOCAL_SWAP_BACK_TOOLS } from '@safecontext/policy';
import type { PageServerLoad } from './$types';

/** The published policy's swap-back tools (issue #83). Editing comes with the policy editor (#23). */
export const load: PageServerLoad = async () => {
	const org = await currentOrganization();
	const policy = await latestPolicy(org.id);
	const local: readonly string[] = LOCAL_SWAP_BACK_TOOLS;
	return {
		swapBack: policy && {
			version: policy.version,
			local: policy.swapBack.tools.filter((t) => local.includes(t)),
			added: policy.swapBack.tools.filter((t) => !local.includes(t))
		}
	};
};
