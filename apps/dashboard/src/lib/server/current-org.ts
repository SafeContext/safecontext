// TEMPORARY, replaced by admin sign-in (#19).
//
// There is no signed-in admin yet, so every dashboard page shows the seeded demo organisation.
// This is the ONLY place that decides which organisation's data a page sees: #19 should replace
// `currentOrganization` with "the signed-in admin's organisation" (and reject requests without one).
import { error } from '@sveltejs/kit';
import { prisma } from '#lib/server/prisma.ts';

/** The organisation `pnpm --filter @safecontext/dashboard db:seed` creates. */
export const DEMO_ORG_SLUG = 'macrohard-demo';

export type CurrentOrganization = { id: string; name: string };

export async function currentOrganization(): Promise<CurrentOrganization> {
	const org = await prisma.organization.findUnique({
		where: { slug: DEMO_ORG_SLUG },
		select: { id: true, name: true }
	});
	if (!org) {
		error(503, 'No organisation yet. Run `pnpm --filter @safecontext/dashboard db:seed`.');
	}
	return org;
}
