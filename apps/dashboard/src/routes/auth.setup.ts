// Playwright setup (issue #19): signs in as the seeded demo admin and saves the cookies, so the
// other e2e tests start signed in. Signing in once also keeps them under Better Auth's sign-in
// rate limit (3 tries per 10 s per address).
import { expect, test as setup } from '@playwright/test';
import { DEMO_ADMIN } from '../../prisma/demo-admin.ts';
import { ADMIN_STATE } from '../../playwright.config.ts';

setup('sign in as the demo admin', async ({ page }) => {
	await page.goto('/sign-in');
	await page.getByLabel('Email').fill(DEMO_ADMIN.email);
	await page.getByLabel('Password').fill(DEMO_ADMIN.password);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
	await page.context().storageState({ path: ADMIN_STATE });
});
