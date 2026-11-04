// Seeds a demo organisation: the default data types from @safecontext/policy, a published policy
// v1, two sample term lists and some demo events. Safe to re-run: it never overwrites rows that
// already exist (so it won't undo an admin's edits) and only adds events to an organisation that has none.
//
// Run with: pnpm --filter @safecontext/dashboard db:seed
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
	AgentEvent,
	DEFAULT_DATA_TYPES,
	Policy,
	type Action,
	type DataType,
	type TermList
} from '@safecontext/policy';
import { PrismaClient } from '../src/lib/server/generated/prisma/client.ts';

const connectionString = process.env['DATABASE_URL'];
if (!connectionString) throw new Error('DATABASE_URL is not set (see apps/dashboard/.env.example)');

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const ORG_SLUG = 'macrohard-demo';

/** Demo term lists (codenames, customers) attached to default data types. */
const DEMO_LISTS: TermList[] = [
	{ dataTypeId: 'customer-names', terms: ['Northwind', 'Acme Corp', 'Contoso'] },
	{ dataTypeId: 'unreleased-roadmap', terms: ['Project Atlas', 'Project Helios'] }
];

const DEMO_DEVICE_IDS = ['dev-a1b2c3', 'dev-d4e5f6', 'dev-0a9b8c', 'dev-7f6e5d'];
const DEMO_TOOLS = ['Read', 'Bash', 'Grep', 'WebFetch', 'WebSearch', 'mcp__slack__post'];
const DEMO_EVENT_COUNT = 60;

/** Small deterministic PRNG so every seeded database looks the same. */
function mulberry32(seed: number): () => number {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Builds demo events (validated against the real AgentEvent contract) spread over the last 24 h. */
function demoEvents(dataTypes: DataType[], policyVersion: number, now: Date): AgentEvent[] {
	const rand = mulberry32(18);
	const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)]!;
	const events: AgentEvent[] = [];

	for (let i = 0; i < DEMO_EVENT_COUNT; i++) {
		const hookEvent = pick([
			'UserPromptSubmit',
			'PreToolUse',
			'PostToolUse',
			'PostToolUse'
		] as const);
		const counts: Record<string, number> = {};
		for (const dt of dataTypes) {
			// Most checks find nothing; red types are rarer than yellow ones.
			const chance = dt.tier === 'red' ? 0.08 : dt.tier === 'yellow' ? 0.18 : 0.12;
			if (rand() < chance) counts[dt.id] = 1 + Math.floor(rand() * 4);
		}
		const actions: Partial<Record<Action, number>> = {};
		for (const dt of dataTypes) {
			const n = counts[dt.id];
			if (n) actions[dt.action] = (actions[dt.action] ?? 0) + n;
		}

		events.push(
			AgentEvent.parse({
				ts: new Date(now.getTime() - Math.floor(rand() * 24 * 3600 * 1000)).toISOString(),
				deviceId: pick(DEMO_DEVICE_IDS),
				policyVersion,
				hookEvent,
				...(hookEvent === 'UserPromptSubmit' ? {} : { toolName: pick(DEMO_TOOLS) }),
				counts,
				actions,
				blocked: hookEvent !== 'PostToolUse' && (actions.block ?? 0) > 0,
				latencyMs: Math.round((20 + rand() * 280) * 10) / 10
			})
		);
	}
	return events.sort((a, b) => a.ts.localeCompare(b.ts));
}

async function main() {
	const now = new Date();

	const org = await prisma.organization.upsert({
		where: { slug: ORG_SLUG },
		update: {},
		create: { slug: ORG_SLUG, name: 'Macrohard (demo)' }
	});

	await prisma.member.upsert({
		where: { organizationId_email: { organizationId: org.id, email: 'admin@macrohard.example' } },
		update: {},
		create: { organizationId: org.id, email: 'admin@macrohard.example', name: 'Demo Admin' }
	});

	// Data types: one row per default, ordered within their column.
	const positionInTier: Record<string, number> = {};
	for (const dt of DEFAULT_DATA_TYPES) {
		const position = (positionInTier[dt.tier] = (positionInTier[dt.tier] ?? -1) + 1);
		await prisma.dataType.upsert({
			where: { organizationId_key: { organizationId: org.id, key: dt.id } },
			update: {},
			create: {
				organizationId: org.id,
				key: dt.id,
				name: dt.name,
				description: dt.description,
				examples: dt.examples,
				tier: dt.tier,
				action: dt.action,
				position
			}
		});
	}

	for (const list of DEMO_LISTS) {
		const dataType = await prisma.dataType.findUniqueOrThrow({
			where: { organizationId_key: { organizationId: org.id, key: list.dataTypeId } }
		});
		await prisma.termList.upsert({
			where: { dataTypeId: dataType.id },
			update: {},
			create: { dataTypeId: dataType.id, terms: list.terms }
		});
	}

	// Policy v1: a snapshot of the rows above, validated against the real Policy contract.
	let version = await prisma.policyVersion.findFirst({
		where: { organizationId: org.id },
		orderBy: { version: 'desc' }
	});
	if (!version) {
		const policy = Policy.parse({
			version: 1,
			updatedAt: now.toISOString(),
			dataTypes: DEFAULT_DATA_TYPES,
			lists: DEMO_LISTS,
			failMode: org.failMode
		});
		version = await prisma.policyVersion.create({
			data: {
				organizationId: org.id,
				version: policy.version,
				failMode: policy.failMode,
				snapshot: policy
			}
		});
	}

	// Devices and events (only if this organisation has none yet).
	if ((await prisma.event.count({ where: { organizationId: org.id } })) === 0) {
		const devices = new Map<string, string>();
		for (const deviceId of DEMO_DEVICE_IDS) {
			const device = await prisma.device.upsert({
				where: { organizationId_deviceId: { organizationId: org.id, deviceId } },
				update: {},
				create: { organizationId: org.id, deviceId }
			});
			devices.set(deviceId, device.id);
		}

		const events = demoEvents(DEFAULT_DATA_TYPES, version.version, now);
		for (const e of events) {
			await prisma.event.create({
				data: {
					organizationId: org.id,
					deviceId: devices.get(e.deviceId)!,
					ts: new Date(e.ts),
					policyVersion: e.policyVersion,
					hookEvent: e.hookEvent,
					toolName: e.toolName ?? null,
					blocked: e.blocked,
					latencyMs: e.latencyMs,
					actionAllow: e.actions.allow ?? 0,
					actionGeneralize: e.actions.generalize ?? 0,
					actionPseudonymize: e.actions.pseudonymize ?? 0,
					actionMask: e.actions.mask ?? 0,
					actionBlock: e.actions.block ?? 0,
					counts: {
						create: Object.entries(e.counts).map(([dataTypeKey, count]) => ({ dataTypeKey, count }))
					}
				}
			});
		}

		for (const [deviceId, id] of devices) {
			const mine = events.filter((e) => e.deviceId === deviceId);
			await prisma.device.update({
				where: { id },
				data: {
					firstSeenAt: new Date(mine[0]?.ts ?? now),
					lastSeenAt: new Date(mine.at(-1)?.ts ?? now),
					lastPolicyVersion: version.version
				}
			});
		}
	}

	const [dataTypes, lists, policies, devices, events] = await Promise.all([
		prisma.dataType.count({ where: { organizationId: org.id } }),
		prisma.termList.count({ where: { dataType: { organizationId: org.id } } }),
		prisma.policyVersion.count({ where: { organizationId: org.id } }),
		prisma.device.count({ where: { organizationId: org.id } }),
		prisma.event.count({ where: { organizationId: org.id } })
	]);
	console.log(
		`Seeded "${org.name}": ${dataTypes} data types, ${lists} term lists, ${policies} policy version(s), ${devices} devices, ${events} events.`
	);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
