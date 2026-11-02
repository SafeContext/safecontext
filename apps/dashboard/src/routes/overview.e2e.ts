// The Overview page end to end (issue #24): a check uploaded through the real agent API shows up
// in the open page's live feed within ~1 s.
//
// The page shows the seeded demo organisation (see src/lib/server/current-org.ts), so the test
// adds a throwaway device to it with a token it knows, and deletes the device (and with it, its
// events) afterwards. Needs the local database with `db:seed` applied.
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';

const DEMO_ORG_SLUG = 'macrohard-demo';
const deviceId = `dev-e2e-${randomBytes(4).toString('hex')}`;
const token = `scd_${randomBytes(32).toString('base64url')}`;
let db: pg.Client;

test.beforeAll(async () => {
	db = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
	await db.connect();
	const { rowCount } = await db.query(
		`INSERT INTO "Device" ("id", "organizationId", "deviceId", "tokenHash", "tokenIssuedAt")
		 SELECT gen_random_uuid(), "id", $1, $2, now() FROM "Organization" WHERE "slug" = $3`,
		[deviceId, createHash('sha256').update(token).digest('hex'), DEMO_ORG_SLUG]
	);
	expect(rowCount, 'the demo organisation exists (run db:seed)').toBe(1);
});

test.afterAll(async () => {
	await db.query(`DELETE FROM "Device" WHERE "deviceId" = $1`, [deviceId]);
	await db.end();
});

const statValue = (page: import('@playwright/test').Page, label: string) =>
	page.getByRole('region', { name: label }).getByTestId('stat-value');

test('a new event appears in the live feed within ~1 s', async ({ page, request }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Overview');
	await expect(page.getByTestId('feed-status')).toHaveAttribute('data-status', 'live');

	const blocked = async () =>
		Number((await statValue(page, 'Blocked').textContent())!.replaceAll(',', ''));
	const before = await blocked();

	const started = Date.now();
	const res = await request.post('/api/events', {
		headers: { authorization: `Bearer ${token}` },
		data: {
			events: [
				{
					ts: new Date().toISOString(),
					deviceId,
					policyVersion: 1,
					hookEvent: 'PreToolUse',
					toolName: 'WebFetch',
					counts: { secrets: 1 },
					actions: { block: 1 },
					blocked: true,
					latencyMs: 8
				}
			]
		}
	});
	expect(res.status()).toBe(200);

	const row = page.getByTestId('feed-row').filter({ hasText: deviceId });
	await expect(row).toBeVisible({ timeout: 1000 });
	const elapsed = Date.now() - started;
	console.log(`Event appeared in the feed ${elapsed} ms after upload started.`);
	expect(elapsed).toBeLessThan(1000);

	await expect(row).toContainText('WebFetch');
	await expect(row).toContainText('Blocked');
	await expect(row).toContainText('just now');
	// At least: other checkouts may be uploading to the demo organisation at the same time.
	await expect.poll(blocked).toBeGreaterThanOrEqual(before + 1);
});

test('stat cards and feed rows show counts and names only', async ({ page }) => {
	await page.goto('/');
	for (const label of ['Checked', 'Safe to share', 'Made vague', 'Blocked']) {
		await expect(statValue(page, label)).toHaveText(/^[\d,]+$/);
	}
	await expect(page.getByTestId('feed-row').first()).toBeVisible();
});

test.describe('phone (375px)', () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test('overview fits without horizontal scroll', async ({ page }, testInfo) => {
		await page.goto('/');
		await expect(page.getByTestId('feed-row').first()).toBeVisible();
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
		await testInfo.attach('overview-phone.png', {
			body: await page.screenshot(),
			contentType: 'image/png'
		});
	});
});
