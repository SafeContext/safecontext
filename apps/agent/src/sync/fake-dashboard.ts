/**
 * A fake dashboard agent API (`DASHBOARD_API`, issue #21) on an ephemeral loopback port. For
 * tests only; not imported by the agent. Behaves like the real one for the paths the agent uses,
 * and records what it received so tests can check it.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
	AgentEventBatch,
	DASHBOARD_API,
	DeviceRegistrationRequest,
	type AgentEvent,
	type ApiErrorCode,
	type Policy
} from '@safecontext/policy';

export const ENROLLMENT_KEY = 'sce_test-enrollment-key';

export interface FakeReply {
	status: number;
	headers?: Record<string, string>;
	body?: unknown;
}

export interface FakeDashboard {
	url: string;
	/** Published policy, or undefined for 404 `no_policy`. */
	policy: Policy | undefined;
	/** Valid device tokens, by token. */
	tokens: Map<string, string>;
	/** Every event batch accepted, in order. */
	batches: AgentEvent[][];
	/** Raw request bodies received on /api/events, for "no text" checks. */
	rawEventBodies: string[];
	requests: Array<{ method: string; path: string; ifNoneMatch?: string; auth?: string }>;
	registrations: number;
	/** Replies to use instead of the normal behaviour, per path, consumed first in first out. */
	override: Map<string, FakeReply[]>;
	/** Issue a token for `deviceId` without the agent registering. */
	issueToken(deviceId: string): string;
	close(): Promise<void>;
}

export async function startFakeDashboard(): Promise<FakeDashboard> {
	let counter = 0;
	const fake: Omit<FakeDashboard, 'url' | 'close'> = {
		policy: undefined,
		tokens: new Map(),
		batches: [],
		rawEventBodies: [],
		requests: [],
		registrations: 0,
		override: new Map(),
		issueToken(deviceId) {
			// Re-registering rotates: the old token for this device stops working.
			for (const [token, id] of fake.tokens) if (id === deviceId) fake.tokens.delete(token);
			const token = `scd_test${++counter}`;
			fake.tokens.set(token, deviceId);
			return token;
		}
	};

	const error = (code: ApiErrorCode, status: number, headers: Record<string, string> = {}): FakeReply => ({
		status,
		headers,
		body: { error: { code, message: code } }
	});

	function handle(req: IncomingMessage, raw: string): FakeReply {
		const path = req.url ?? '';
		const auth = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
		const ifNoneMatch = req.headers['if-none-match'];
		fake.requests.push({ method: req.method ?? '', path, ...(ifNoneMatch && { ifNoneMatch }), ...(auth && { auth }) });
		const queued = fake.override.get(path)?.shift();
		if (queued) return queued;

		if (req.method === 'POST' && path === DASHBOARD_API.registerDevice.path) {
			if (auth !== ENROLLMENT_KEY) return error('unauthorized', 401);
			const body = DeviceRegistrationRequest.safeParse(JSON.parse(raw));
			if (!body.success) return error('invalid_body', 422);
			fake.registrations++;
			return { status: 201, body: { deviceId: body.data.deviceId, token: fake.issueToken(body.data.deviceId) } };
		}
		const deviceId = auth === undefined ? undefined : fake.tokens.get(auth);
		if (deviceId === undefined) return error('unauthorized', 401);

		if (req.method === 'GET' && path === DASHBOARD_API.policy.path) {
			if (!fake.policy) return error('no_policy', 404);
			const etag = `"policy-v${fake.policy.version}"`;
			if (ifNoneMatch === etag) return { status: 304, headers: { etag } };
			return { status: 200, headers: { etag }, body: fake.policy };
		}
		if (req.method === 'POST' && path === DASHBOARD_API.events.path) {
			if (!/^application\/json/.test(req.headers['content-type'] ?? '')) return error('bad_request', 415);
			fake.rawEventBodies.push(raw);
			const body = AgentEventBatch.safeParse(JSON.parse(raw));
			if (!body.success) return error('invalid_body', 422);
			if (body.data.events.some((e) => e.deviceId !== deviceId)) return error('device_mismatch', 403);
			fake.batches.push(body.data.events);
			return { status: 200, body: { accepted: body.data.events.length } };
		}
		return { status: 404 };
	}

	const server = createServer((req: IncomingMessage, res: ServerResponse) => {
		let raw = '';
		req.setEncoding('utf8');
		req.on('data', (chunk: string) => (raw += chunk));
		req.on('end', () => {
			let reply: FakeReply;
			try {
				reply = handle(req, raw);
			} catch {
				reply = error('bad_request', 400);
			}
			const headers: Record<string, string> = { ...reply.headers };
			if (reply.body !== undefined) headers['content-type'] = 'application/json';
			res.writeHead(reply.status, headers);
			res.end(reply.body === undefined ? undefined : JSON.stringify(reply.body));
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;

	return Object.assign(fake, {
		url: `http://127.0.0.1:${port}`,
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	});
}
