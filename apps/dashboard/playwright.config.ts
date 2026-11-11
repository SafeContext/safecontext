import { defineConfig } from '@playwright/test';

// PLAYWRIGHT_PORT lets parallel checkouts (e.g. several worktrees) run e2e tests side by side.
const port = Number(process.env['PLAYWRIGHT_PORT'] ?? 4173);

/** Cookies of the signed-in demo admin, written by `src/routes/auth.setup.ts` (gitignored). */
export const ADMIN_STATE = 'playwright/.auth/admin.json';

export default defineConfig({
	webServer: { command: `npm run build && npm run preview -- --port ${port} --strictPort`, port },
	projects: [
		// Signs in once as the seeded demo admin (needs `db:seed`), so other tests start signed in.
		{ name: 'setup', testMatch: '**/auth.setup.ts' },
		{
			name: 'chromium',
			testMatch: '**/*.e2e.{ts,js}',
			dependencies: ['setup'],
			use: { storageState: ADMIN_STATE }
		}
	]
});
