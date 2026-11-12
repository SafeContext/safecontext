// Adds a dashboard admin to an organisation (issue #19), or gives an existing one a new password.
// Prints a new random password once: only its hash is stored. Running it again for the same
// email replaces the password and signs that admin out everywhere.
//
// `--viewer` makes someone who can see the dashboard but not change the policy; `--admin` turns a
// viewer back into an admin (issue #23). Without either, a new person is an admin and an existing
// one keeps their role.
//
// Stopgap until the dashboard can invite admins itself.
//
// Run with: pnpm --filter @safecontext/dashboard create-admin <org-slug> <email> [name] [--viewer|--admin]
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/lib/server/generated/prisma/client.ts';
import { ensureAdmin } from '../src/lib/server/admin-accounts.ts';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set (see apps/dashboard/.env.example)');

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const [slug, email, name] = args.filter((a) => !a.startsWith('--'));
const unknown = flags.filter((f) => f !== '--viewer' && f !== '--admin');
if (!slug || !email?.includes('@') || unknown.length > 0 || flags.length > 1) {
	console.error(
		'Usage: pnpm --filter @safecontext/dashboard create-admin <org-slug> <email> [name] [--viewer|--admin]'
	);
	process.exit(1);
}
const role = flags[0] === '--viewer' ? 'viewer' : flags[0] === '--admin' ? 'admin' : undefined;

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
		resetPassword: true,
		...(role && { role })
	});
	const member = await prisma.member.findFirstOrThrow({
		where: { organizationId: org.id, email: { equals: email.trim(), mode: 'insensitive' } },
		select: { role: true }
	});
	const can = member.role === 'viewer' ? 'see the dashboard (not change the policy)' : 'sign in';
	console.log(`${email} can now ${can} in "${org.name}" (${slug}) with this password.`);
	console.log(`Pass it on securely; it can't be shown again.\n\n${password}`);
} catch (error) {
	console.error(`Could not add ${email} to organisation "${slug}".`);
	throw error;
} finally {
	await prisma.$disconnect();
}
