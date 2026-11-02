import { defineConfig } from '@playwright/test';

// PLAYWRIGHT_PORT lets parallel checkouts (e.g. several worktrees) run e2e tests side by side.
const port = Number(process.env['PLAYWRIGHT_PORT'] ?? 4173);

export default defineConfig({
	webServer: { command: `npm run build && npm run preview -- --port ${port} --strictPort`, port },
	testMatch: '**/*.e2e.{ts,js}'
});
