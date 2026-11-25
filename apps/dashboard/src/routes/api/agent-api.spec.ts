// The agent-side flow against the real handlers and the local database (issue #21):
// register -> pull policy (ETag/304) -> upload events (stored + NOTIFY). Uses its own throwaway
// organisation and deletes it afterwards; nothing else in the database is touched.
import { DATABASE_URL } from '$app/env/private';
import {
	ApiError,
	DEFAULT_DATA_TYPES,
	DeviceRegistrationResponse,
	EventBatchResponse,
	Policy,
	type AgentEvent
} from '@safecontext/policy';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetRateLimits } from '#lib/server/agent-api/rate-limit.ts';
import { hashSecret, newSecret } from '#lib/server/agent-api/secrets.ts';
import { listDevices, revokeDevice, rotateEnrollmentKey } from '#lib/server/devices.ts';
import { EVENTS_CHANNEL, EventNotification } from '#lib/server/live-events.ts';
import { prisma } from '#lib/server/prisma.ts';
import { POST as registerDevice } from './devices/+server.ts';
import { POST as postEvents } from './events/+server.ts';
import { GET as getPolicy } from './policy/+server.ts';

type Handler = (event: never) => Response | Promise<Response>;

/** Calls a route handler the way SvelteKit would, with just the parts of the event we use. */
function call(
	handler: Handler,
	init: { method?: string; headers?: Record<string, string>; body?: unknown; ip?: string } = {}
): Promise<Response> {
	const hasBody = init.body !== undefined;
	const request = new Request('http://localhost/api', {
		method: init.method ?? (hasBody ? 'POST' : 'GET'),
		headers: { ...(hasBody ? { 'content-type': 'application/json' } : {}), ...init.headers },
		body: !hasBody
			? undefined
			: typeof init.body === 'string'
				? init.body
				: JSON.stringify(init.body)
	});
	const event = { request, getClientAddress: () => init.ip ?? '192.0.2.1' };
	return Promise.resolve(handler(event as never));
}

const auth = (secret: string) => ({ authorization: `Bearer ${secret}` });

const slug = `test-agent-api-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const enrollmentKey = newSecret('enrollmentKey');
let organizationId = '';

function policy(version: number): Policy {
	return Policy.parse({
		version,
		updatedAt: new Date().toISOString(),
		dataTypes: DEFAULT_DATA_TYPES,
		failMode: 'block'
	});
}

async function publish(version: number) {
	const p = policy(version);
	await prisma.policyVersion.create({
		data: { organizationId, version, failMode: p.failMode, snapshot: p }
	});
}

function agentEvent(deviceId: string, extra: Partial<AgentEvent> = {}): AgentEvent {
	return {
		ts: new Date().toISOString(),
		deviceId,
		policyVersion: 1,
		hookEvent: 'PostToolUse',
		toolName: 'Read',
		counts: { 'customer-names': 2, secrets: 1 },
		actions: { pseudonymize: 2, block: 1 },
		blocked: false,
		latencyMs: 41.5,
		...extra
	};
}

async function register(body: Record<string, unknown> = {}) {
	const res = await call(registerDevice, { headers: auth(enrollmentKey), body });
	return { res, body: DeviceRegistrationResponse.parse(await res.json()) };
}

beforeAll(async () => {
	const org = await prisma.organization.create({
		data: { slug, name: 'Agent API test', enrollmentKeyHash: hashSecret(enrollmentKey) }
	});
	organizationId = org.id;
});

afterAll(async () => {
	await prisma.organization.deleteMany({ where: { slug } });
});

beforeEach(() => resetRateLimits());

describe('POST /api/devices', () => {
	it('rejects a missing or wrong enrollment key', async () => {
		for (const headers of [{}, auth('sce_nope'), auth(newSecret('enrollmentKey'))]) {
			const res = await call(registerDevice, { headers, body: {} });
			expect(res.status).toBe(401);
			expect(ApiError.parse(await res.json()).error.code).toBe('unauthorized');
		}
	});

	it('picks the device id itself, so a key holder cannot claim an existing device (#51)', async () => {
		const res = await call(registerDevice, {
			headers: auth(enrollmentKey),
			body: { deviceId: 'dev-someone-else' }
		});
		expect(res.status).toBe(422);
	});

	it('rejects a label that is too long or not printable', async () => {
		for (const label of ['x'.repeat(65), 'line\nbreak', ' ']) {
			const res = await call(registerDevice, { headers: auth(enrollmentKey), body: { label } });
			expect(res.status).toBe(422);
		}
	});

	it('registers a new device each time, storing only the token hash', async () => {
		const first = await register({ label: '  Asset 1042 ' });
		expect(first.res.status).toBe(201);
		expect(first.res.headers.get('cache-control')).toBe('no-store');
		expect(first.body.deviceId).toMatch(/^dev-[0-9a-f]{32}$/);

		const device = await prisma.device.findUniqueOrThrow({
			where: { organizationId_deviceId: { organizationId, deviceId: first.body.deviceId } }
		});
		expect(device.tokenHash).toBe(hashSecret(first.body.token)); // only the hash is stored
		expect(device.label).toBe('Asset 1042');

		const second = await register();
		expect(second.res.status).toBe(201);
		expect(second.body.deviceId).not.toBe(first.body.deviceId);
		expect(second.body.token).not.toBe(first.body.token);
		// Registering again never touches an existing device's token.
		expect((await call(getPolicy, { headers: auth(first.body.token) })).status).not.toBe(401);
	});
});

describe('GET /api/policy', () => {
	it('needs a device token', async () => {
		expect((await call(getPolicy)).status).toBe(401);
		expect((await call(getPolicy, { headers: auth(enrollmentKey) })).status).toBe(401);
	});

	it('serves the latest version with an ETag, and 304 when unchanged', async () => {
		const { body } = await register();

		const none = await call(getPolicy, { headers: auth(body.token) });
		expect(none.status).toBe(404);
		expect(ApiError.parse(await none.json()).error.code).toBe('no_policy');

		await publish(1);
		await publish(2);
		const res = await call(getPolicy, { headers: auth(body.token) });
		expect(res.status).toBe(200);
		expect(Policy.parse(await res.json()).version).toBe(2);
		const etag = res.headers.get('etag')!;
		expect(etag).toBe('"policy-v2"');

		const cached = await call(getPolicy, {
			headers: { ...auth(body.token), 'if-none-match': etag }
		});
		expect(cached.status).toBe(304);
		expect(await cached.text()).toBe('');

		await publish(3);
		const changed = await call(getPolicy, {
			headers: { ...auth(body.token), 'if-none-match': etag }
		});
		expect(changed.status).toBe(200);
		expect(changed.headers.get('etag')).toBe('"policy-v3"');
	});
});

describe('POST /api/events', () => {
	let token = '';
	let dev = '';
	beforeAll(async () => {
		({ token, deviceId: dev } = (await register()).body);
	});

	const post = (body: unknown, headers: Record<string, string> = {}) =>
		call(postEvents, { headers: { ...auth(token), ...headers }, body });

	it('stores a batch with its counts, updates the device and notifies listeners', async () => {
		const listener = new pg.Client({ connectionString: DATABASE_URL });
		await listener.connect();
		const received: EventNotification[] = [];
		listener.on('notification', (msg) => {
			if (msg.channel !== EVENTS_CHANNEL || !msg.payload) return;
			const n = EventNotification.parse(JSON.parse(msg.payload));
			if (n.organizationId === organizationId) received.push(n);
		});
		await listener.query(`LISTEN ${EVENTS_CHANNEL}`);

		try {
			const events = [
				agentEvent(dev),
				agentEvent(dev, {
					hookEvent: 'UserPromptSubmit',
					toolName: undefined,
					counts: {},
					actions: { block: 1 },
					blocked: true,
					policyVersion: 3
				})
			];
			const res = await post({ events });
			expect(res.status).toBe(200);
			expect(EventBatchResponse.parse(await res.json())).toEqual({ accepted: 2 });

			const stored = await prisma.event.findMany({
				where: { organizationId, device: { deviceId: dev } },
				include: { counts: true },
				orderBy: { policyVersion: 'asc' }
			});
			expect(stored).toHaveLength(2);
			expect(stored[0]!.counts.map((c) => [c.dataTypeKey, c.count]).sort()).toEqual([
				['customer-names', 2],
				['secrets', 1]
			]);
			expect(stored[0]!.actionPseudonymize).toBe(2);
			expect(stored[1]!.toolName).toBeNull();

			const device = await prisma.device.findFirstOrThrow({
				where: { organizationId, deviceId: dev }
			});
			expect(device.lastPolicyVersion).toBe(3);

			await expect.poll(() => received.length, { timeout: 2000 }).toBe(2);
			expect(received.map((n) => n.id).sort()).toEqual(stored.map((e) => e.id).sort());
			expect(received.find((n) => n.blocked)).toMatchObject({
				deviceId: dev,
				hookEvent: 'UserPromptSubmit',
				toolName: null,
				actions: { allow: 0, generalize: 0, pseudonymize: 0, mask: 0, block: 1 }
			});
		} finally {
			await listener.end();
		}
	});

	it('rejects any text field and stores nothing from that batch', async () => {
		const before = await prisma.event.count({ where: { organizationId } });
		const secret = 'Q3 revenue was $4.2M at Northwind';
		for (const bad of [
			{ events: [agentEvent(dev), { ...agentEvent(dev), prompt: secret }] },
			{ events: [agentEvent(dev, { counts: { [secret]: 1 } })] },
			{ events: [agentEvent(dev, { toolName: secret })] },
			{ events: [agentEvent(dev)], text: secret }
		]) {
			const res = await post(bad);
			expect(res.status).toBe(422);
			const raw = await res.text();
			expect(ApiError.parse(JSON.parse(raw)).error.code).toBe('invalid_body');
			expect(raw).not.toContain('Northwind'); // errors never echo the text back
		}
		expect(await prisma.event.count({ where: { organizationId } })).toBe(before);
	});

	it('rejects numbers the database cannot hold with a 422, not a 500', async () => {
		for (const bad of [
			agentEvent(dev, { counts: { secrets: 3_000_000_000 } }),
			agentEvent(dev, { policyVersion: 3_000_000_000 })
		]) {
			const res = await post({ events: [bad] });
			expect(res.status).toBe(422);
			expect(ApiError.parse(await res.json()).error.code).toBe('invalid_body');
		}
	});

	it('rejects events for another device', async () => {
		const res = await post({ events: [agentEvent(dev), agentEvent('dev-someone-else')] });
		expect(res.status).toBe(403);
		expect(ApiError.parse(await res.json()).error.code).toBe('device_mismatch');
	});

	it('rejects bodies that are not JSON, empty batches and missing tokens', async () => {
		expect((await post('{not json')).status).toBe(400);
		expect((await post({ events: [] })).status).toBe(422);
		expect(
			(
				await post(JSON.stringify({ events: [agentEvent(dev)] }), {
					'content-type': 'text/plain'
				})
			).status
		).toBe(415);
		const res = await call(postEvents, { body: { events: [agentEvent(dev)] } });
		expect(res.status).toBe(401);
	});
});

describe('rate limiting', () => {
	it('limits a device that uploads too often', async () => {
		const { body } = await register();
		const statuses: number[] = [];
		for (let i = 0; i < 30; i++) {
			// An empty batch fails validation, which is cheap, but still counts against the limit.
			statuses.push(
				(await call(postEvents, { headers: auth(body.token), body: { events: [] } })).status
			);
		}
		expect(statuses.every((s) => s === 422)).toBe(true);
		const limited = await call(postEvents, { headers: auth(body.token), body: { events: [] } });
		expect(limited.status).toBe(429);
		expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
	});

	it('slows down a client that keeps guessing tokens', async () => {
		const ip = '198.51.100.7';
		for (let i = 0; i < 20; i++) {
			const res = await call(getPolicy, { headers: auth(newSecret('deviceToken')), ip });
			expect(res.status).toBe(401);
		}
		const res = await call(getPolicy, { headers: auth(newSecret('deviceToken')), ip });
		expect(res.status).toBe(429);
		expect(ApiError.parse(await res.json()).error.code).toBe('rate_limited');
	});
});

describe('revoking devices and rotating the enrollment key (#51)', () => {
	it('stops a revoked device at once, and only in its own organisation', async () => {
		const { body } = await register({ label: 'Lost laptop' });
		const row = await prisma.device.findFirstOrThrow({ where: { deviceId: body.deviceId } });
		const other = await prisma.organization.create({
			data: { slug: `${slug}-other`, name: 'Someone else' }
		});
		try {
			expect(await revokeDevice(other.id, row.id)).toBe(false); // not theirs
			expect((await call(getPolicy, { headers: auth(body.token) })).status).not.toBe(401);

			expect(await revokeDevice(organizationId, row.id)).toBe(true);
			expect(await revokeDevice(organizationId, row.id)).toBe(false); // already revoked
			expect((await call(getPolicy, { headers: auth(body.token) })).status).toBe(401);

			const listed = (await listDevices(organizationId)).devices.find((d) => d.id === row.id);
			expect(listed).toMatchObject({ label: 'Lost laptop', status: 'revoked' });
		} finally {
			await prisma.organization.delete({ where: { id: other.id } });
		}
	});

	it('lists devices most recently seen first, with no secrets', async () => {
		const list = await listDevices(organizationId);
		expect(list.total).toBeGreaterThanOrEqual(list.devices.length);
		expect(list.active).toBeLessThanOrEqual(list.total);
		const seen = list.devices.map((d) => d.lastSeenAt.getTime());
		expect(seen).toEqual([...seen].sort((a, b) => b - a));
		expect(JSON.stringify(list)).not.toMatch(/tokenHash|scd_/);
	});

	it('a new key replaces the old one; devices that already joined keep working', async () => {
		const { body } = await register();
		const fresh = await rotateEnrollmentKey(organizationId);
		try {
			expect(fresh).toMatch(/^sce_/);
			const old = await call(registerDevice, { headers: auth(enrollmentKey), body: {} });
			expect(old.status).toBe(401);
			const joined = await call(registerDevice, { headers: auth(fresh), body: {} });
			expect(joined.status).toBe(201);
			expect((await call(getPolicy, { headers: auth(body.token) })).status).not.toBe(401);
			const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
			expect(org.enrollmentKeyHash).toBe(hashSecret(fresh)); // only the hash is stored
		} finally {
			await prisma.organization.update({
				where: { id: organizationId },
				data: { enrollmentKeyHash: hashSecret(enrollmentKey) }
			});
		}
	});
});
