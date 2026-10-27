// Stores a validated `AgentEventBatch` and notifies the live feed.
import type { AgentEventBatch } from '@safecontext/policy';
import { prisma } from '#lib/server/prisma.ts';
import { EVENTS_CHANNEL, type EventNotification } from '#lib/server/live-events.ts';
import type { AuthedDevice } from './auth.ts';
import { uuidv7 } from './secrets.ts';

/**
 * Inserts every event (with its counts), updates the device and sends one NOTIFY per event, all in
 * one transaction: a batch is stored completely or not at all.
 * The caller has already checked that every event belongs to `device`.
 */
export async function storeEvents(device: AuthedDevice, batch: AgentEventBatch): Promise<number> {
	const receivedAt = new Date();

	const rows = batch.events.map((e) => ({
		id: uuidv7(receivedAt.getTime()),
		organizationId: device.organizationId,
		deviceId: device.id,
		ts: new Date(e.ts),
		receivedAt,
		policyVersion: e.policyVersion,
		hookEvent: e.hookEvent,
		toolName: e.toolName ?? null,
		blocked: e.blocked,
		latencyMs: e.latencyMs,
		actionAllow: e.actions.allow ?? 0,
		actionGeneralize: e.actions.generalize ?? 0,
		actionPseudonymize: e.actions.pseudonymize ?? 0,
		actionMask: e.actions.mask ?? 0,
		actionBlock: e.actions.block ?? 0
	}));

	const counts = batch.events.flatMap((e, i) =>
		Object.entries(e.counts).map(([dataTypeKey, count]) => ({
			eventId: rows[i]!.id,
			dataTypeKey,
			count
		}))
	);

	const notifications = rows.map((r): string =>
		JSON.stringify({
			v: 1,
			id: r.id,
			organizationId: r.organizationId,
			deviceId: device.deviceId,
			ts: r.ts.toISOString(),
			receivedAt: r.receivedAt.toISOString(),
			policyVersion: r.policyVersion,
			hookEvent: r.hookEvent,
			toolName: r.toolName,
			blocked: r.blocked,
			latencyMs: r.latencyMs,
			actions: {
				allow: r.actionAllow,
				generalize: r.actionGeneralize,
				pseudonymize: r.actionPseudonymize,
				mask: r.actionMask,
				block: r.actionBlock
			}
		} satisfies EventNotification)
	);

	// The agent only ever moves to newer policies, so the highest version seen is the current one.
	// (Taking the max also keeps a late retry of an old batch from moving it backwards.)
	const policyVersion = Math.max(...rows.map((r) => r.policyVersion));

	await prisma.$transaction(async (tx) => {
		await tx.event.createMany({ data: rows });
		if (counts.length) await tx.eventCount.createMany({ data: counts });
		await tx.$executeRaw`
			UPDATE "Device"
			SET "lastSeenAt" = ${receivedAt},
			    "lastPolicyVersion" = GREATEST(COALESCE("lastPolicyVersion", 0), ${policyVersion}::int)
			WHERE "id" = ${device.id}::uuid`;
		await tx.$executeRaw`
			SELECT pg_notify(${EVENTS_CHANNEL}, payload)
			FROM unnest(${notifications}::text[]) WITH ORDINALITY AS n(payload, i)
			ORDER BY i`;
	});

	return rows.length;
}
