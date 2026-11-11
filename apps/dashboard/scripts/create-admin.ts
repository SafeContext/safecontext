// Adds a dashboard admin to an organisation (issue #19), or gives an existing one a new password.
// Prints a new random password once: only its hash is stored. Running it again for the same
// email replaces the password and signs that admin out everywhere.
//
// Stopgap until the dashboard can invite admins itself.
//
// Run with: pnpm --filter @safecontext/dashboard create-admin <org-slug> <email> [name]
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/lib/server/generated/prisma/client.ts';
import { ensureAdmin } from '../src/lib/server/admin-accounts.ts';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set (see apps/dashboard/.env.example)');

const [slug, email, name] = process.argv.slice(2);
if (!slug || !email?.includes('@')) {
	console.error(
		'Usage: pnpm --filter @safecontext/dashboard create-admin <org-slug> <email> [name]'
	);
	process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

try {
	const org = await prisma.organization.findUniqueOrThrow({
		where: { slug },
		select: { id: true, name: true }
	});
	const password = randomBytes(18).toString('base64url');
	await ensureAdmin(prisma, {
		organizationId: org.id,
		email,
		name: name ?? email.split('@')[0]!,
		password,
		resetPassword: true
	});
	console.log(`${email} can now sign in to "${org.name}" (${slug}) with this password.`);
	console.log(`Pass it on securely; it can't be shown again.\n\n${password}`);
} catch (error) {
	console.error(`Could not add ${email} to organisation "${slug}".`);
	throw error;
} finally {
	await prisma.$disconnect();
}
