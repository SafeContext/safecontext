// The Settings page end to end (issue #51): an admin sees the organisation's devices and revokes
// one, and its token stops working.
//
// Runs signed in as the seeded demo admin (auth.setup.ts). The test adds a throwaway device with
// a label to the demo organisation and deletes it afterwards. It never makes a new enrollment
// key, so a local demo agent can still join. Needs the local database with `db:seed` applied.
import 'dotenv/config';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import pg from 'pg';

const DEMO_ORG_SLUG = 'macrohard-demo';
const deviceId = `dev-e2e-${randomBytes(4).toString('hex')}`;
const label = `E2E asset ${randomBytes(2).toString('hex')}`;
const token = `scd_${randomBytes(32).toString('base64url')}`;
let db: pg.Client;

test.beforeAll(async () => {
	db = new pg.Client({ connectionString: process.env['DATABASE_URL'] });
	await db.connect();
	const { rowCount } = await db.query(
		`INSERT INTO "Device" ("id", "organizationId", "deviceId", "label", "tokenHash", "tokenIssuedAt")
		 SELECT gen_random_uuid(), "id", $1, $2, $3, now() FROM "Organization" WHERE "slug" = $4`,
		[deviceId, label, createHash('sha256').update(token).digest('hex'), DEMO_ORG_SLUG]
	);
	expect(rowCount, 'the demo organisation exists (run db:seed)').toBe(1);
});

test.afterAll(async () => {
	await db.query(`DELETE FROM "Device" WHERE "deviceId" = $1`, [deviceId]);
	await db.end();
});

test('lists devices and revokes one, which stops its token (#51)', async ({ page, request }) => {
	await page.goto('/settings');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Settings');
	await expect(page.getByRole('heading', { name: 'Enrollment key' })).toBeVisible();
	await expect(page.getByTestId('key-status')).toBeVisible();

	const row = page.getByTestId('device-row').filter({ hasText: label });
	await expect(row).toContainText(deviceId);
	await expect(row).toContainText('Active');
	expect((await request.get('/api/policy', { headers: { authorization: `Bearer ${token}` } })).status()).not.toBe(401);

	page.once('dialog', (dialog) => dialog.accept());
	await row.getByRole('button', { name: `Revoke ${label}` }).click();
	await expect(page.getByTestId('notice')).toHaveText(new RegExp(`${label} revoked`));
	await expect(row).toContainText('Revoked');
	await expect(row.getByRole('button', { name: /Revoke/ })).toHaveCount(0);

	const { rows } = await db.query(`SELECT "tokenHash", "revokedAt" FROM "Device" WHERE "deviceId" = $1`, [deviceId]);
	expect(rows[0]).toMatchObject({ tokenHash: null, revokedAt: expect.any(Date) });
	expect((await request.get('/api/policy', { headers: { authorization: `Bearer ${token}` } })).status()).toBe(401);
});
