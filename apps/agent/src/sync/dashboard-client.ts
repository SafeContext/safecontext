/**
 * HTTP client for the dashboard's agent API (`DASHBOARD_API` in @safecontext/policy, issue #21).
 * Every call returns a result object and never throws, so the sync loops decide what to do next.
 * Request and response bodies are checked against the shared contracts. Secrets (enrollment key,
 * device token) only ever go in the `Authorization` header.
 */
import {
	AgentEventBatch,
	ApiError,
	DASHBOARD_API,
	DeviceRegistrationRequest,
	DeviceRegistrationResponse,
	EventBatchResponse,
	Policy,
	type AgentEvent,
	type ApiErrorCode
} from '@safecontext/policy';

export type Failure =
	/** Couldn't reach the dashboard. */
	| { ok: false; reason: 'network' | 'timeout' }
	/** 5xx. */
	| { ok: false; reason: 'server_error'; status: number }
	/** 401: the token or enrollment key isn't accepted. */
	| { ok: false; reason: 'unauthorized'; status: 401 }
	/** 403: an event's deviceId isn't the token's device. */
	| { ok: false; reason: 'device_mismatch'; status: 403 }
	/** 429. `retryAfterMs` from the `Retry-After` header, if any. */
	| { ok: false; reason: 'rate_limited'; status: 429; retryAfterMs?: number }
	/** 413: body too large. */
	| { ok: false; reason: 'too_large'; status: 413 }
	/** Any other 4xx: the request is wrong and retrying won't help. */
	| { ok: false; reason: 'rejected'; status: number; code?: ApiErrorCode }
	/** 2xx with a body that doesn't match the contract. */
	| { ok: false; reason: 'bad_response'; status: number };

export type PolicyResult =
	| { ok: true; status: 200; policy: Policy; etag?: string }
	| { ok: true; status: 304 }
	| { ok: false; reason: 'no_policy'; status: 404 }
	| Failure;

export type RegisterResult = { ok: true; token: string } | Failure;
export type EventsResult = { ok: true; accepted: number } | Failure;

export interface DashboardClient {
	registerDevice(enrollmentKey: string, deviceId: string): Promise<RegisterResult>;
	getPolicy(token: string, etag?: string): Promise<PolicyResult>;
	postEvents(token: string, events: AgentEvent[]): Promise<EventsResult>;
}

export interface DashboardClientOptions {
	/** Dashboard base URL, e.g. `https://safecontext.example.com`. A path prefix is kept. */
	baseUrl: string;
	/** Per-request timeout. */
	timeoutMs?: number;
	fetch?: typeof globalThis.fetch;
	userAgent?: string;
}

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

export function createDashboardClient(opts: DashboardClientOptions): DashboardClient {
	const base = opts.baseUrl.replace(/\/+$/, '');
	const timeoutMs = opts.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
	const doFetch = opts.fetch ?? globalThis.fetch;
	const userAgent = opts.userAgent ?? 'safecontext-agent';

	async function request(
		method: 'GET' | 'POST',
		path: string,
		secret: string,
		init: { body?: unknown; headers?: Record<string, string> } = {}
	): Promise<{ ok: true; res: Response } | { ok: false; reason: 'network' | 'timeout' }> {
		const headers: Record<string, string> = {
			authorization: `Bearer ${secret}`,
			accept: 'application/json',
			'user-agent': userAgent,
			...init.headers
		};
		if (init.body !== undefined) headers['content-type'] = 'application/json';
		try {
			const res = await doFetch(base + path, {
				method,
				headers,
				...(init.body !== undefined && { body: JSON.stringify(init.body) }),
				redirect: 'error',
				signal: AbortSignal.timeout(timeoutMs)
			});
			return { ok: true, res };
		} catch (err) {
			const name = (err as Error | undefined)?.name;
			return { ok: false, reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' };
		}
	}

	return {
		async registerDevice(enrollmentKey, deviceId) {
			const api = DASHBOARD_API.registerDevice;
			const body = api.request.parse({ deviceId } satisfies DeviceRegistrationRequest);
			const sent = await request(api.method, api.path, enrollmentKey, { body });
			if (!sent.ok) return sent;
			const { res } = sent;
			if (res.status !== 200 && res.status !== 201) return failure(res);
			const parsed = DeviceRegistrationResponse.safeParse(await json(res));
			if (!parsed.success || parsed.data.deviceId !== deviceId) {
				return { ok: false, reason: 'bad_response', status: res.status };
			}
			return { ok: true, token: parsed.data.token };
		},

		async getPolicy(token, etag) {
			const api = DASHBOARD_API.policy;
			const sent = await request(api.method, api.path, token, {
				...(etag !== undefined && { headers: { 'if-none-match': etag } })
			});
			if (!sent.ok) return sent;
			const { res } = sent;
			if (res.status === 304) {
				await res.body?.cancel();
				return { ok: true, status: 304 };
			}
			if (res.status === 200) {
				const parsed = Policy.safeParse(await json(res));
				if (!parsed.success) return { ok: false, reason: 'bad_response', status: 200 };
				const newEtag = res.headers.get('etag') ?? undefined;
				return { ok: true, status: 200, policy: parsed.data, ...(newEtag && { etag: newEtag }) };
			}
			const fail = await failure(res);
			if (fail.reason === 'rejected' && fail.status === 404 && fail.code === 'no_policy') {
				return { ok: false, reason: 'no_policy', status: 404 };
			}
			return fail;
		},

		async postEvents(token, events) {
			const api = DASHBOARD_API.events;
			const batch = AgentEventBatch.safeParse({ events });
			// Status 0: refused locally, nothing was sent.
			if (!batch.success) return { ok: false, reason: 'rejected', status: 0 };
			const sent = await request(api.method, api.path, token, { body: batch.data });
			if (!sent.ok) return sent;
			const { res } = sent;
			if (res.status !== 200) return failure(res);
			const parsed = EventBatchResponse.safeParse(await json(res));
			if (!parsed.success) return { ok: false, reason: 'bad_response', status: 200 };
			return { ok: true, accepted: parsed.data.accepted };
		}
	};
}

async function json(res: Response): Promise<unknown> {
	try {
		return await res.json();
	} catch {
		return undefined;
	}
}

async function failure(res: Response): Promise<Failure> {
	const { status } = res;
	if (status >= 200 && status < 300) {
		await res.body?.cancel();
		return { ok: false, reason: 'bad_response', status };
	}
	if (status >= 500 || status < 400) {
		await res.body?.cancel();
		return { ok: false, reason: 'server_error', status };
	}
	const error = ApiError.safeParse(await json(res));
	const code = error.success ? error.data.error.code : undefined;
	if (status === 401) return { ok: false, reason: 'unauthorized', status: 401 };
	if (status === 403 && code === 'device_mismatch') return { ok: false, reason: 'device_mismatch', status: 403 };
	if (status === 413) return { ok: false, reason: 'too_large', status: 413 };
	if (status === 429) {
		const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
		return { ok: false, reason: 'rate_limited', status: 429, ...(retryAfterMs !== undefined && { retryAfterMs }) };
	}
	return { ok: false, reason: 'rejected', status, ...(code !== undefined && { code }) };
}

/** `Retry-After` as ms: either delay-seconds or an HTTP date. Undefined if missing or unreadable. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | undefined {
	if (value === null) return undefined;
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
	const date = Date.parse(trimmed);
	if (Number.isNaN(date)) return undefined;
	return Math.max(0, date - now);
}
