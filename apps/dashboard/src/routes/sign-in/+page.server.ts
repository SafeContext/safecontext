import { redirect } from '@sveltejs/kit';
import { safeRedirectTarget } from '#lib/route-access.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	const redirectTo = safeRedirectTarget(url.searchParams.get('redirectTo'));
	// Already signed in: carry on to where they were going.
	if (locals.admin) redirect(303, redirectTo);
	return { redirectTo };
};
