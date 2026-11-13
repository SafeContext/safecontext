// The policy editor (issue #23), signed in as the seeded demo admin. Leaves the draft as it found
// it: the data type it adds, it deletes again, and it never publishes.
import { expect, test } from '@playwright/test';

test('shows the two protected columns with the default data types', async ({ page }) => {
	await page.goto('/policy');
	for (const [tier, title] of [
		['yellow', 'Make it vague'],
		['red', 'Never share']
	]) {
		await expect(page.getByTestId(`column-${tier}`).getByRole('heading')).toContainText(title);
	}
	// No "Safe to share" column: nothing looks for green data types.
	await expect(page.getByTestId('column-green')).toHaveCount(0);
	await expect(page.getByTestId('column-red').getByTestId('pill-secrets')).toBeVisible();
	await expect(page.getByTestId('publish-bar')).toContainText(/version \d+/);
});

test('opening a built-in data type shows it can be moved but not deleted', async ({ page }) => {
	await page.goto('/policy');
	await page.getByTestId('pill-secrets').click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('heading', { name: 'API keys & secrets' })).toBeVisible();
	await expect(dialog.getByText('You can move it, but not delete it.')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toHaveCount(0);
});

test('adds a data type with a word list, then deletes it', async ({ page }) => {
	const name = `E2E test type ${Date.now().toString(36)}`;
	await page.goto('/policy');
	await page.getByRole('button', { name: 'Add data type' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Column').selectOption('red');
	await dialog.getByLabel('Name').fill(name);
	await expect(dialog.getByTestId('no-words-warning')).toBeVisible();
	await dialog.getByLabel('Word list').fill('Oakwood Clinic\nSt Mary Hospital');
	await expect(dialog.getByTestId('term-count')).toHaveText('2 entries');
	await expect(dialog.getByTestId('no-words-warning')).toHaveCount(0);
	await dialog.getByRole('button', { name: 'Add', exact: true }).click();

	const pill = page.getByTestId('column-red').getByRole('button', { name: new RegExp(name) });
	await expect(pill).toContainText('2 words');
	await expect(page.getByTestId('notice')).toContainText(`Added “${name}”`);
	await expect(page.getByTestId('publish-bar')).toContainText('Unpublished changes');

	page.once('dialog', (confirm) => confirm.accept());
	await pill.click();
	await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
	await expect(page.getByTestId('notice')).toContainText(`Deleted “${name}”`);
	await expect(pill).toHaveCount(0);
});

test('a tool whose input goes to Anthropic is refused for swap-back', async ({ page }) => {
	await page.goto('/policy');
	await page.getByLabel('Tool name').fill('WebFetch');
	await page.getByRole('button', { name: 'Add tool' }).click();
	await expect(page.getByTestId('notice')).toContainText('WebFetch');
	await expect(page.getByTestId('swap-back-added').getByText('WebFetch')).toHaveCount(0);
});

test('the fail mode section names the time limit and both choices', async ({ page }) => {
	await page.goto('/policy');
	await expect(page.getByTestId('fail-mode-causes')).toContainText('longer than 8 seconds');
	await expect(page.getByRole('radio', { name: /Block it/ })).toBeVisible();
	await expect(page.getByRole('radio', { name: /Let it through/ })).toBeVisible();
	await expect(page.getByTestId('agent-down-note')).toContainText('everything there is blocked');
});
