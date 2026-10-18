import { expect, test } from '@playwright/test';

const widths = {
	phone: { width: 375, height: 812 },
	tablet: { width: 768, height: 1024 },
	desktop: { width: 1440, height: 900 }
} as const;

for (const [name, viewport] of Object.entries(widths)) {
	test.describe(`${name} (${viewport.width}px)`, () => {
		test.use({ viewport });

		test('shell renders without horizontal scroll', async ({ page }, testInfo) => {
			await page.goto('/policy');

			await expect(page.getByTestId('org-name')).toContainText('Macrohard');
			await expect(page.getByRole('heading', { level: 1 })).toHaveText('Policy');

			const overflow = await page.evaluate(
				() => document.documentElement.scrollWidth - document.documentElement.clientWidth
			);
			expect(overflow).toBeLessThanOrEqual(0);

			await testInfo.attach(`${name}.png`, {
				body: await page.screenshot(),
				contentType: 'image/png'
			});
		});

		if (viewport.width < 768) {
			test('navigation opens from the menu button', async ({ page }) => {
				await page.goto('/');
				const nav = page.getByRole('navigation', { name: 'Main' });
				await expect(nav).not.toBeInViewport();

				await page.getByRole('button', { name: 'Menu' }).click();
				await expect(nav).toBeInViewport();
				for (const label of ['Overview', 'Policy', 'Deploy', 'Settings']) {
					await expect(nav.getByRole('link', { name: label })).toBeVisible();
				}

				await nav.getByRole('link', { name: 'Deploy' }).click();
				await expect(page).toHaveURL(/\/deploy$/);
				await expect(nav).not.toBeInViewport();
			});
		} else {
			test('sidebar is always visible and marks the current page', async ({ page }) => {
				await page.goto('/deploy');
				const nav = page.getByRole('navigation', { name: 'Main' });
				await expect(nav).toBeInViewport();
				await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
				await expect(nav.getByRole('link', { name: 'Deploy' })).toHaveAttribute(
					'aria-current',
					'page'
				);
			});
		}
	});
}
