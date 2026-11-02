// `pnpm test:e2e` only: runs real Claude Code, which costs model usage. `pnpm test` skips it.
import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		root: `${import.meta.dirname}/..`,
		include: ['e2e/**/*.e2e.ts'],
		testTimeout: 180_000,
		hookTimeout: 60_000
	}
});
