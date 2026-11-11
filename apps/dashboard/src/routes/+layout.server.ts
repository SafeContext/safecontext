import type { LayoutServerLoad } from './$types';

/** The signed-in admin for the header (null on the sign-in page). Names only, no ids. */
export const load: LayoutServerLoad = ({ locals }) => ({
	admin: locals.admin
		? {
				email: locals.admin.email,
				name: locals.admin.name,
				organizationName: locals.admin.organization.name
			}
		: null
});
