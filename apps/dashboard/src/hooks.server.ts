// Every request passes through here first (issue #19):
// 1. Better Auth's own endpoints (/api/auth/...) go straight to Better Auth.
// 2. The agent API (/api/devices, /api/policy, /api/events) checks its own device tokens, so it
//    skips the dashboard session entirely.
// 3. Everything else needs a signed-in admin; without one, requests redirect to /sign-in.
import { building } from '$app/env';
import { redirect, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { isAuthPath } from 'better-auth/svelte-kit';
import { isAgentApiPath, SIGN_IN_PATH, signInRedirect } from '#lib/route-access.ts';
import { auth, CLIENT_IP_HEADER } from '#lib/server/auth.ts';
import { adminForUser } from '#lib/server/members.ts';

/** The request with the client's address in `CLIENT_IP_HEADER` (for Better Auth's rate limit). */
function withClientIp(event: RequestEvent): Request {
	const headers = new Headers(event.request.headers);
	headers.set(CLIENT_IP_HEADER, event.getClientAddress());
	return new Request(event.request, { headers });
}

export const handle: Handle = async ({ event, resolve }) => {
	if (building) return resolve(event);

	const { pathname } = event.url;
	if (isAuthPath(event.url.toString(), auth.options)) return auth.handler(withClientIp(event));
	if (isAgentApiPath(pathname)) return resolve(event);

	const found = await auth.api.getSession({ headers: event.request.headers });
	const admin = found && (await adminForUser(found.user.id));
	if (found && admin) {
		event.locals.user = found.user;
		event.locals.session = found.session;
		event.locals.admin = admin;
	}

	if (pathname === SIGN_IN_PATH || event.locals.admin) return resolve(event);
	redirect(303, signInRedirect(event.url));
};
