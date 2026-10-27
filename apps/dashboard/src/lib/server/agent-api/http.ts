// Small HTTP helpers for the agent API (`src/routes/api/`). Error bodies follow `ApiError` from
// @safecontext/policy and never echo request values: the request might contain text by mistake,
// and the whole point of this API is that text never lands anywhere on the dashboard side.
import { AgentEvent, Action, type ApiError, type ApiErrorCode } from '@safecontext/policy';
import type * as z from 'zod';

type Issue = NonNullable<ApiError['error']['issues']>[number];

export function apiError(
	status: number,
	code: ApiErrorCode,
	message: string,
	init: { headers?: Record<string, string>; issues?: Issue[] } = {}
): Response {
	const body: ApiError = {
		error: { code, message, ...(init.issues ? { issues: init.issues } : {}) }
	};
	return Response.json(body, {
		status,
		headers: { 'cache-control': 'no-store', ...init.headers }
	});
}

export function rateLimited(retryAfterSeconds: number): Response {
	return apiError(429, 'rate_limited', 'Too many requests. Try again later.', {
		headers: { 'retry-after': String(retryAfterSeconds) }
	});
}

/** The value of `Authorization: Bearer <value>`, or null. */
export function bearer(request: Request): string | null {
	const match = /^Bearer\s+(\S+)\s*$/i.exec(request.headers.get('authorization') ?? '');
	return match?.[1] ?? null;
}

/**
 * Field names that may appear in an error path. Anything else (record keys such as `counts`
 * keys, or unknown fields) becomes "*", so a stray value can't be echoed back in the error.
 */
const SAFE_PATH_SEGMENTS = new Set<string>([
	'events',
	...Object.keys(AgentEvent.shape),
	...Action.options
]);

function safeIssues(error: z.ZodError): Issue[] {
	return error.issues.slice(0, 20).map((issue) => ({
		path: issue.path.map((p) =>
			typeof p === 'number' ? p : typeof p === 'string' && SAFE_PATH_SEGMENTS.has(p) ? p : '*'
		),
		// Zod names the offending keys in this message ("Unrecognized key: ..."). Leave them out.
		message:
			issue.code === 'unrecognized_keys'
				? 'Unknown field. Only the fields in the contract are allowed.'
				: issue.message
	}));
}

/**
 * Reads and validates a JSON body. Returns the parsed value, or an error `Response` to return as is.
 */
export async function readJson<S extends z.ZodType>(
	request: Request,
	schema: S,
	maxBytes: number
): Promise<{ ok: true; data: z.output<S> } | { ok: false; response: Response }> {
	const type = request.headers.get('content-type') ?? '';
	if (!/^application\/json\s*(;|$)/i.test(type)) {
		return {
			ok: false,
			response: apiError(415, 'bad_request', 'Send the body as application/json.')
		};
	}
	const tooLarge = () => ({
		ok: false as const,
		response: apiError(413, 'bad_request', `Body is larger than ${maxBytes} bytes.`)
	});
	if (Number(request.headers.get('content-length') ?? 0) > maxBytes) return tooLarge();

	const raw = await request.text();
	if (Buffer.byteLength(raw, 'utf8') > maxBytes) return tooLarge();

	let json: unknown;
	try {
		json = JSON.parse(raw);
	} catch {
		return { ok: false, response: apiError(400, 'bad_request', 'Body is not valid JSON.') };
	}

	const parsed = schema.safeParse(json);
	if (!parsed.success) {
		return {
			ok: false,
			response: apiError(422, 'invalid_body', 'Body does not match the contract.', {
				issues: safeIssues(parsed.error)
			})
		};
	}
	return { ok: true, data: parsed.data };
}
