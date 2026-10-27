// One Postgres LISTEN connection per server process, shared by every open live feed (issue #24).
//
// Prisma can't LISTEN, so this uses `pg` directly. The connection opens on the first subscriber
// and stays open. If it drops, every subscriber is told (`onClose`) and dropped; the browser then
// reconnects and reloads the page data, so nothing sent while the connection was down is missed.
import { DATABASE_URL } from '$app/env/private';
import pg from 'pg';
import { EVENTS_CHANNEL, EventNotification } from '#lib/server/live-events.ts';

export type Subscriber = {
	onEvent: (event: EventNotification) => void;
	/** The connection to Postgres was lost. The subscriber has already been removed. */
	onClose: () => void;
};

const subscribers = new Set<Subscriber>();
let connection: Promise<pg.Client> | null = null;

function connect(): Promise<pg.Client> {
	const client = new pg.Client({ connectionString: DATABASE_URL });
	let lost = false;
	const drop = () => {
		if (lost) return;
		lost = true;
		connection = null;
		client.end().catch(() => {});
		const dropped = [...subscribers];
		subscribers.clear();
		for (const s of dropped) s.onClose();
	};

	client.on('notification', (msg) => {
		if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
		let event: EventNotification;
		try {
			event = EventNotification.parse(JSON.parse(msg.payload));
		} catch {
			return; // Not ours or not understood: never forward anything we didn't validate.
		}
		for (const s of subscribers) s.onEvent(event);
	});
	client.on('error', drop);
	client.on('end', drop);

	return client
		.connect()
		.then(() => client.query(`LISTEN ${EVENTS_CHANNEL}`))
		.then(() => client)
		.catch((err: unknown) => {
			drop();
			throw err;
		});
}

/**
 * Starts receiving every committed event (all organisations: filter on `organizationId`).
 * Resolves once LISTEN is active, with a function that unsubscribes. Rejects if Postgres can't be
 * reached.
 */
export async function subscribe(subscriber: Subscriber): Promise<() => void> {
	connection ??= connect();
	await connection;
	subscribers.add(subscriber);
	return () => {
		subscribers.delete(subscriber);
	};
}

/** Closes the shared connection (for tests). Subscribers get `onClose`. */
export async function closeListener(): Promise<void> {
	const client = await connection?.catch(() => null);
	await client?.end();
}
