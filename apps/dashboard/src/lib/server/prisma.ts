// Prisma 7 client (server-only: lives under src/lib/server so SvelteKit blocks client imports).
// Setup follows https://www.prisma.io/docs/v7/prisma-orm/add-to-existing-project/postgresql
import { DATABASE_URL } from '$app/env/private';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';
import { PG_SESSION_OPTIONS } from './pg-session.ts';

const adapter = new PrismaPg({ connectionString: DATABASE_URL, options: PG_SESSION_OPTIONS });

export const prisma = new PrismaClient({ adapter });
