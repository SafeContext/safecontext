// Prisma 7 client (server-only: lives under src/lib/server so SvelteKit blocks client imports).
// Setup follows https://www.prisma.io/docs/v7/prisma-orm/add-to-existing-project/postgresql
import { DATABASE_URL } from '$app/env/private';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

const adapter = new PrismaPg({ connectionString: DATABASE_URL });

export const prisma = new PrismaClient({ adapter });
