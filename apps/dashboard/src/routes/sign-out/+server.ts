// POST /sign-out: ends the admin's session (the Header's "Sign out" button), then shows sign-in.
import { redirect } from '@sveltejs/kit';
import { SIGN_IN_PATH } from '#lib/route-access.ts';
import { auth } from '#lib/server/auth.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
	// Deletes the session row; the cookies are cleared through the sveltekitCookies plugin.
	await auth.api.signOut({ headers: request.headers });
	redirect(303, SIGN_IN_PATH);
};
