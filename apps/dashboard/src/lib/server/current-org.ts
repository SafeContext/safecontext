// The organisation whose data a dashboard page may see: the signed-in admin's (issue #19).
//
// This is the ONLY place that decides it. `hooks.server.ts` signs the admin in and redirects
// signed-out visitors, so on dashboard pages there is always one; anywhere else (e.g. the agent
// API, which has no session) this refuses rather than guess.
import { getRequestEvent } from '$app/server';
import { error } from '@sveltejs/kit';

export type CurrentOrganization = { id: string; name: string };

export function currentOrganization(): CurrentOrganization {
	const { admin } = getRequestEvent().locals;
	if (!admin) error(401, 'Sign in to see this organisation');
	return admin.organization;
}
