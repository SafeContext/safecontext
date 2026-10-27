// Queries behind the Overview page (issue #24). Metadata only: see `#lib/feed.ts`.
import { eventResult, FEED_LIMIT, FeedEvent, type OverviewStats } from '#lib/feed.ts';
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
