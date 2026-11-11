// Admin sign-in (issue #19): Better Auth with its Prisma adapter, email + password only.
// Docs: https://www.better-auth.com/docs/integrations/svelte-kit and /docs/adapters/prisma.
//
// - Nobody can sign up from the browser. Accounts come from `scripts/create-admin.ts` (or the seed
//   for the demo admin), which also adds the Member row that says which organisation they run.
// - Signing in links the account to its Member (`linkMember`) and is refused if there is none.
// - Better Auth's endpoints live under /api/auth (`hooks.server.ts` routes requests to them).
import { BETTER_AUTH_SECRET, BETTER_AUTH_URL } from '$app/env/private';
import { getRequestEvent } from '$app/server';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { MIN_PASSWORD_LENGTH } from '#lib/server/admin-accounts.ts';
import { linkMember } from '#lib/server/members.ts';
import { prisma } from '#lib/server/prisma.ts';

/**
 * Header `hooks.server.ts` sets to the client's address before handing a request to Better Auth,
 * so its sign-in rate limit counts per address. Any value the client sent is replaced.
 */
export const CLIENT_IP_HEADER = 'x-safecontext-client-ip';

export const auth = betterAuth({
	secret: BETTER_AUTH_SECRET,
	// Unset locally: Better Auth then takes the origin from each request.
	...(BETTER_AUTH_URL ? { baseURL: BETTER_AUTH_URL } : {}),
	database: prismaAdapter(prisma, { provider: 'postgresql' }),
	emailAndPassword: {
		enabled: true,
		disableSignUp: true,
		minPasswordLength: MIN_PASSWORD_LENGTH
	},
	advanced: {
		ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] }
	},
	databaseHooks: {
		session: {
			create: {
				// Returning false stops the session being created, so sign-in fails.
				before: async (session) => ((await linkMember(session.userId)) ? undefined : false)
			}
		}
	},
	telemetry: { enabled: false },
	// Lets server code (e.g. sign-out) set cookies. Must stay last.
	plugins: [sveltekitCookies(getRequestEvent)]
});
