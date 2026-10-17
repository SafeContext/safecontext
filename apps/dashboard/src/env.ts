import { defineEnvVars } from '@sveltejs/kit/env';

// Declares the environment variables the app reads. See https://svelte.dev/docs/kit/environment-variables
export const variables = defineEnvVars({
	// Private (server-only). Read via `$app/env/private`.
	DATABASE_URL: {}
});
