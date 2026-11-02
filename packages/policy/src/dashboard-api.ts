/**
 * The dashboard's HTTP API for the local agent (issue #21): register a device, pull the policy,
 * upload events. All bodies are JSON. Every endpoint except registration uses the device token:
 *
 *     Authorization: Bearer <device token>
 *
 * Registration uses the organisation's enrollment key in the same header instead. Both are opaque
 * strings: store them as secrets (the agent keeps its token in the macOS Keychain, issue #22).
 */
import * as z from 'zod';
import { AgentEventBatch } from './events.ts';
import { Id, Policy } from './policy.ts';

/** `POST /api/devices` body. `deviceId` is the agent's anonymised id (`AgentEvent.deviceId`). */
export const DeviceRegistrationRequest = z.strictObject({
	deviceId: Id
});
export type DeviceRegistrationRequest = z.infer<typeof DeviceRegistrationRequest>;

/**
 * `POST /api/devices` response (201 new device, 200 known device). The token is only ever shown
 * here. Registering an existing `deviceId` again issues a new token and the old one stops working.
 */
export const DeviceRegistrationResponse = z.strictObject({
	deviceId: Id,
	token: z.string().min(1)
});
export type DeviceRegistrationResponse = z.infer<typeof DeviceRegistrationResponse>;

/** `POST /api/events` response. The batch is stored all-or-nothing. */
export const EventBatchResponse = z.strictObject({
	accepted: z.number().int().nonnegative()
});
export type EventBatchResponse = z.infer<typeof EventBatchResponse>;

/** Machine-readable error codes in `ApiError.error.code`. */
export const ApiErrorCode = z.enum([
	/** Missing, malformed or unknown token / enrollment key (401). */
	'unauthorized',
	/** An event's `deviceId` is not the authenticated device (403). */
	'device_mismatch',
	/** No policy has been published yet (404). The agent should keep its cached or default policy. */
	'no_policy',
	/** Body isn't JSON, or is too large (400 / 413 / 415). */
	'bad_request',
	/** Body is JSON but fails the contract (422). `issues` says where. */
	'invalid_body',
	/** Too many requests (429). Honour the `Retry-After` header (seconds). */
	'rate_limited'
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

/** Body of every 4xx response. Never echoes request values back, only paths into the body. */
export const ApiError = z.strictObject({
	error: z.strictObject({
		code: ApiErrorCode,
		message: z.string(),
		issues: z
			.array(z.strictObject({ path: z.array(z.union([z.string(), z.number()])), message: z.string() }))
			.optional()
	})
});
export type ApiError = z.infer<typeof ApiError>;

export const DASHBOARD_API = {
	/** Auth: enrollment key. */
	registerDevice: {
		method: 'POST',
		path: '/api/devices',
		request: DeviceRegistrationRequest,
		response: DeviceRegistrationResponse
	},
	/**
	 * Auth: device token. Returns the latest published policy with an `ETag`. Send it back as
	 * `If-None-Match` and an unchanged policy returns 304 with no body.
	 */
	policy: { method: 'GET', path: '/api/policy', response: Policy },
	/** Auth: device token. Every event's `deviceId` must be the authenticated device's. */
	events: { method: 'POST', path: '/api/events', request: AgentEventBatch, response: EventBatchResponse }
} as const;
