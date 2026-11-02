// Creates a new enrollment key for an organisation and prints it once. Agents send it to
// `POST /api/devices` to register. Only its hash is stored, so it can't be shown again: run this
// again to replace it (devices that already registered keep working; new ones need the new key).
//
// Stopgap until the dashboard has a settings page for it (needs admin sign-in, #19).
//
// Run with: pnpm --filter @safecontext/dashboard enrollment-key [org-slug]   (default: macrohard-demo)
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/lib/server/generated/prisma/client.ts';
import { hashSecret, newSecret } from '../src/lib/server/agent-api/secrets.ts';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set (see apps/dashboard/.env.example)');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
const slug = process.argv[2] ?? 'macrohard-demo';

try {
	const key = newSecret('enrollmentKey');
	const org = await prisma.organization.update({
		where: { slug },
		data: { enrollmentKeyHash: hashSecret(key), enrollmentKeyCreatedAt: new Date() },
		select: { name: true }
	});
	console.log(`New enrollment key for "${org.name}" (${slug}). It replaces any previous key.`);
	console.log(`Store it somewhere safe; it can't be shown again.\n\n${key}`);
} catch (error) {
	console.error(`Could not set an enrollment key for organisation "${slug}".`);
	throw error;
} finally {
	await prisma.$disconnect();
}
