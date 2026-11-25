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

test('downloads the MDM profile for the agent, built in the browser (#26)', async ({ page }) => {
	await page.goto('/deploy');
	const button = page.getByTestId('download-profile');
	await expect(button).toBeDisabled();
	const key = `sce_${'a'.repeat(43)}`;
	await page.getByTestId('profile-key').fill(key);
	await page.getByLabel('Device name (optional)').fill('$SERIALNUMBER');
	await page.getByLabel('Model server address (optional)').fill('https://models.example.com/v1');
	await expect(button).toBeDisabled(); // a model server needs its key
	await page.getByLabel('Model server key').fill('model-key');
	const posts: string[] = [];
	page.on('request', (r) => r.method() === 'POST' && posts.push(r.url()));
	const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
	expect(download.suggestedFilename()).toBe('SafeContext.mobileconfig');
	const xml = await (
		await download.createReadStream()
	)
		.toArray()
		.then((c) => Buffer.concat(c).toString('utf8'));
	expect(xml).toContain(
		`<key>DashboardURL</key>\n\t\t\t<string>${new URL(page.url()).origin}</string>`
	);
	expect(xml).toContain(`<string>${key}</string>`);
	expect(xml).toContain('<string>$SERIALNUMBER</string>');
	expect(xml).toContain('<key>ModelServerKey</key>');
	expect(posts).toEqual([]); // the keys never went to the dashboard
});
