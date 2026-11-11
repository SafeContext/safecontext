// The demo admin the seed creates, so you can sign in locally (issue #19). Test credentials for
// the local demo database only: never use them for a real organisation. Playwright signs in with
// them too (`src/routes/auth.setup.ts`).
export const DEMO_ADMIN = {
	email: 'admin@macrohard.example',
	name: 'Demo Admin',
	password: 'macrohard-demo-admin'
} as const;
