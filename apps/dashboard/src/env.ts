import { defineEnvVars } from '@sveltejs/kit/env';

// Declares the environment variables the app reads. See https://svelte.dev/docs/kit/environment-variables
export const variables = defineEnvVars({
	// Private (server-only). Read via `$app/env/private`.
	DATABASE_URL: {},
	BETTER_AUTH_SECRET: {
		description:
			'Signs and encrypts sign-in cookies (Better Auth). At least 32 random characters, e.g. `openssl rand -base64 32`. Changing it signs everyone out.',
		schema: (value) => {
			if (!value || value.length < 32) {
				throw new Error(
					'BETTER_AUTH_SECRET must be at least 32 characters. Generate one with `openssl rand -base64 32` (see apps/dashboard/.env.example).'
				);
			}
			return value;
		}
	},
	BETTER_AUTH_URL: {
		description:
			"The dashboard's public URL, e.g. https://safecontext.example.com. Optional: when unset, it's taken from each request (fine locally).",
		schema: (value) => {
			if (!value) return undefined;
			if (!URL.canParse(value)) throw new Error('BETTER_AUTH_URL must be a full URL');
			return value;
		}
	}
});
