import { expect, test } from '@playwright/test';

test('shows managed settings with the agent hooks, from the published policy (#25)', async ({
	page
}) => {
	await page.goto('/deploy');
	await expect(page.getByRole('heading', { name: 'Deploy to Claude Code' })).toBeVisible();
	const settings = page.getByTestId('managed-settings');
	const json = JSON.parse((await settings.textContent()) ?? '{}');
	expect(Object.keys(json.hooks)).toEqual(
		expect.arrayContaining(['UserPromptSubmit', 'PreToolUse', 'PostToolUse'])
	);
	expect(json.hooks.PreToolUse[0].hooks[0].url).toBe('http://127.0.0.1:4747/v1/tool-input');
	expect(json.forceRemoteSettingsRefresh).toBe(true);
	await page.getByLabel('Fetch these settings again every time Claude Code starts').uncheck();
	expect(JSON.parse((await settings.textContent()) ?? '{}')).not.toHaveProperty(
		'forceRemoteSettingsRefresh'
	);
	await expect(page.getByTestId('plugin-warning')).toContainText(
		"Don't also turn on the Safe Context plugin"
	);
});
