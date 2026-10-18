import { expect, test } from '@playwright/test';

test('has expected h1', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
});

for (const [name, path] of [
	['Overview', '/'],
	['Policy', '/policy'],
	['Deploy', '/deploy'],
	['Settings', '/settings']
]) {
	test(`${name} placeholder page shows an empty state`, async ({ page }) => {
		await page.goto(path);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(name);
		await expect(page.getByRole('heading', { level: 3 })).toBeVisible();
	});
}
