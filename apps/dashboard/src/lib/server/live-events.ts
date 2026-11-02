// The Postgres NOTIFY channel for new events, used by the live feed (#24).
//
// `POST /api/events` sends one notification per stored event, inside the same transaction as the
// insert, so listeners only hear about events that were committed. To listen (Prisma can't, so
// use `pg` directly):
//
//     const client = new pg.Client({ connectionString: DATABASE_URL });
//     await client.connect();
//     client.on('notification', (msg) => {
//       if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
//       const event = EventNotification.parse(JSON.parse(msg.payload));
//       // filter by event.organizationId
//     });
//     await client.query(`LISTEN ${EVENTS_CHANNEL}`);
//
// The payload is metadata only, like the Event row. It leaves out per-data-type counts to stay far
// below NOTIFY's 8000-byte limit; read them from `EventCount` by `id` if you need them.
import { Action, HookEventName, Id } from '@safecontext/policy';
import * as z from 'zod';

export const EVENTS_CHANNEL = 'safecontext_events';

const Count = z.number().int().nonnegative();

export const EventNotification = z.strictObject({
	/** Payload format version. */
	v: z.literal(1),
	/** `Event.id`. */
	id: z.uuid(),
	organizationId: z.uuid(),
	/** The agent's anonymised device id (`Device.deviceId`, `AgentEvent.deviceId`). */
	deviceId: Id,
	/** When the agent made the check. */
	ts: z.iso.datetime(),
	/** When the dashboard stored it. */
	receivedAt: z.iso.datetime(),
	policyVersion: Count,
	hookEvent: HookEventName,
	/** Null for UserPromptSubmit. */
	toolName: z.string().nullable(),
	blocked: z.boolean(),
	latencyMs: z.number().nonnegative(),
	/** Spans handled per action. Every action is present (0 if none). */
	actions: z.strictObject(
		Object.fromEntries(Action.options.map((a) => [a, Count])) as Record<Action, typeof Count>
	)
});
export type EventNotification = z.infer<typeof EventNotification>;
