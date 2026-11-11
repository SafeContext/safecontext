// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { auth } from '#lib/server/auth.ts';
import type { Admin } from '#lib/server/members.ts';

type SignedIn = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>;

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** Set by `hooks.server.ts` when an admin is signed in. Unset on the agent API. */
			user?: SignedIn['user'];
			session?: SignedIn['session'];
			/** The signed-in admin and their organisation. Read it with `currentOrganization()`. */
			admin?: Admin;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
