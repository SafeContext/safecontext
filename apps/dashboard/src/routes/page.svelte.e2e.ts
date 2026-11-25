import { expect, test } from '@playwright/test';

test('has expected h1', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
});

test('Policy page shows where real values go back (#83)', async ({ page }) => {
	await page.goto('/policy');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Policy');
	await expect(page.getByRole('heading', { name: 'Where real values go back' })).toBeVisible();
	const local = page.getByTestId('swap-back-local');
	for (const tool of ['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Glob', 'Grep']) {
		await expect(local.getByText(tool, { exact: true })).toBeVisible();
	}
});
