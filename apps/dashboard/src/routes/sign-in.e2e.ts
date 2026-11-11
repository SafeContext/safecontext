// Admin sign-in end to end (issue #19): signed-out visitors are sent to /sign-in, and come back to
// the page they asked for once signed in. Needs `db:seed` (the demo admin).
import { expect, test } from '@playwright/test';
import { DEMO_ADMIN } from '../../prisma/demo-admin.ts';

// Start signed out, unlike the other tests.
test.use({ storageState: { cookies: [], origins: [] } });

test('signed-out visitors are redirected to sign-in', async ({ page }) => {
	for (const path of ['/', '/policy', '/deploy', '/settings']) {
		await page.goto(path);
		await expect(page, path).toHaveURL(/\/sign-in(\?|$)/);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign in');
		// No app shell (navigation, organisation) before signing in.
		await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
		await expect(page.getByTestId('org-name')).toHaveCount(0);
	}
});

// Serial: these two sign in, and Better Auth allows only 3 tries per 10 s per address (the
// setup project uses one).
test.describe.serial('signing in', () => {
	test('a wrong password shows an error', async ({ page }) => {
		await page.goto('/sign-in');
		await page.getByLabel('Email').fill(DEMO_ADMIN.email);
		await page.getByLabel('Password').fill('not-the-demo-password');
		await page.getByRole('button', { name: 'Sign in' }).click();
		await expect(page.getByRole('alert')).toContainText("don't match an admin account");
		await expect(page).toHaveURL(/\/sign-in$/);
	});

	test('signs in, returns to the page asked for, and signs out', async ({ page }) => {
		await page.goto('/policy');
		await expect(page).toHaveURL(/\/sign-in\?redirectTo=%2Fpolicy$/);

		await page.getByLabel('Email').fill(DEMO_ADMIN.email);
		await page.getByLabel('Password').fill(DEMO_ADMIN.password);
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL(/\/policy$/);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText('Policy');
		await expect(page.getByTestId('org-name')).toContainText('Macrohard (demo)');

		// Signed in, the sign-in page sends you on.
		await page.goto('/sign-in');
		await expect(page).toHaveURL(/\/$/);

		await page.getByRole('button', { name: 'Sign out' }).click();
		await expect(page).toHaveURL(/\/sign-in$/);
		await page.goto('/');
		await expect(page).toHaveURL(/\/sign-in$/);
	});
});
