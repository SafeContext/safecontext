// Queries behind the Overview page (issue #24). Metadata only: see `#lib/feed.ts`.
import {
	emptyDays,
	eventResult,
	FEED_LIMIT,
	FeedEvent,
	type DayCounts,
	type OverviewStats,
	type ProtectedCount
} from '#lib/feed.ts';
import type { EventNotification } from '#lib/server/live-events.ts';
import { prisma } from '#lib/server/prisma.ts';

/** How many checks happened since `since`, split by result (see `eventResult`). */
export async function statsSince(organizationId: string, since: Date): Promise<OverviewStats> {
	const window = { organizationId, ts: { gte: since } };
	const [checked, blocked, vague] = await Promise.all([
		prisma.event.count({ where: window }),
		prisma.event.count({ where: { ...window, blocked: true } }),
		prisma.event.count({
			where: {
				...window,
				blocked: false,
				OR: [
					{ actionGeneralize: { gt: 0 } },
					{ actionPseudonymize: { gt: 0 } },
					{ actionMask: { gt: 0 } },
					{ actionBlock: { gt: 0 } }
				]
			}
		})
	]);
	return { checked, blocked, vague, safe: checked - blocked - vague };
}

/** The latest checks, newest first. */
export async function recentEvents(
	organizationId: string,
	limit = FEED_LIMIT
): Promise<FeedEvent[]> {
	const rows = await prisma.event.findMany({
		where: { organizationId },
		orderBy: [{ ts: 'desc' }, { id: 'desc' }],
		take: limit,
		select: {
			id: true,
			ts: true,
			receivedAt: true,
			hookEvent: true,
			toolName: true,
			blocked: true,
			actionGeneralize: true,
			actionPseudonymize: true,
			actionMask: true,
			actionBlock: true,
			device: { select: { deviceId: true } }
		}
	});
	return rows.map((r) =>
		FeedEvent.parse({
			id: r.id,
			ts: r.ts.toISOString(),
			receivedAt: r.receivedAt.toISOString(),
			hookEvent: r.hookEvent,
			toolName: r.toolName,
			deviceId: r.device.deviceId,
			result: eventResult(r.blocked, {
				generalize: r.actionGeneralize,
				pseudonymize: r.actionPseudonymize,
				mask: r.actionMask,
				block: r.actionBlock
			})
		})
	);
}

/** The feed row for a live notification. */
export function feedEventFromNotification(n: EventNotification): FeedEvent {
	return FeedEvent.parse({
		id: n.id,
		ts: n.ts,
		receivedAt: n.receivedAt,
		hookEvent: n.hookEvent,
		toolName: n.toolName,
		deviceId: n.deviceId,
		result: eventResult(n.blocked, n.actions)
	});
}

/**
 * Checks per UTC day for the last `days` days (today included), split by result like
 * `eventResult`: blocked; else hidden if any span was changed; else nothing found.
 */
export async function dailyCounts(
	organizationId: string,
	now: Date,
	days?: number
): Promise<DayCounts[]> {
	const out = emptyDays(now, days);
	const from = new Date(`${out[0]!.day}T00:00:00Z`);
	// Prisma's Postgres adapter writes and reads timestamps as wall-clock UTC in the database
	// session's time zone, so the UTC day Prisma would report is the wall-clock day in that zone
	// (identical to UTC on a server set to UTC). See the issue linked in the PR.
	const rows = await prisma.$queryRaw<
		{ day: string; blocked: bigint; vague: bigint; checked: bigint }[]
	>`
		SELECT to_char("ts" AT TIME ZONE current_setting('TimeZone'), 'YYYY-MM-DD') AS "day",
			count(*) FILTER (WHERE "blocked") AS "blocked",
			count(*) FILTER (WHERE NOT "blocked" AND
				"actionGeneralize" + "actionPseudonymize" + "actionMask" + "actionBlock" > 0) AS "vague",
			count(*) AS "checked"
		FROM "Event"
		WHERE "organizationId" = ${organizationId}::uuid AND "ts" >= ${from}
		GROUP BY 1`;
	const byDay = new Map(out.map((d) => [d.day, d]));
	for (const r of rows) {
		const d = byDay.get(r.day);
		if (!d) continue;
		d.blocked = Number(r.blocked);
		d.vague = Number(r.vague);
		d.safe = Number(r.checked) - d.blocked - d.vague;
	}
	return out;
}

/** Items found per data type since `since`, most first. Counts only, never the items. */
export async function protectedByType(
	organizationId: string,
	since: Date
): Promise<ProtectedCount[]> {
	const [groups, types] = await Promise.all([
		prisma.eventCount.groupBy({
			by: ['dataTypeKey'],
			where: { event: { organizationId, ts: { gte: since } } },
			_sum: { count: true }
		}),
		prisma.dataType.findMany({
			where: { organizationId },
			select: { key: true, name: true, tier: true }
		})
	]);
	const byKey = new Map(types.map((t) => [t.key, t]));
	return groups
		.map((g) => ({
			key: g.dataTypeKey,
			name: byKey.get(g.dataTypeKey)?.name ?? g.dataTypeKey,
			tier: byKey.get(g.dataTypeKey)?.tier ?? null,
			count: g._sum.count ?? 0
		}))
		.filter((g) => g.count > 0)
		.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export type Rollout = {
	/** The latest published policy version; null if none is published. */
	version: number | null;
	/** Devices whose latest check used that version (or a newer one). */
	current: number;
	devices: number;
};

/** How many of the organisation's devices have picked up the latest published policy. */
export async function policyRollout(organizationId: string): Promise<Rollout> {
	const latest = await prisma.policyVersion.findFirst({
		where: { organizationId },
		orderBy: { version: 'desc' },
		select: { version: true }
	});
	const [devices, current] = await Promise.all([
		prisma.device.count({ where: { organizationId } }),
		latest
			? prisma.device.count({
					where: { organizationId, lastPolicyVersion: { gte: latest.version } }
				})
			: Promise.resolve(0)
	]);
	return { version: latest?.version ?? null, current, devices };
}
