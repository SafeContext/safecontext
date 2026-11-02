// POST /api/events: the agent uploads a batch of events (issue #21). METADATA ONLY.
// Auth: device token. The body must match `AgentEventBatch`, which is strict: any extra field
// (a stray `prompt` or `text`) fails the whole batch, and nothing from it is stored.
import { AgentEventBatch, type EventBatchResponse } from '@safecontext/policy';
import { authenticateDevice } from '#lib/server/agent-api/auth.ts';
import { storeEvents } from '#lib/server/agent-api/events.ts';
import { apiError, rateLimited, readJson } from '#lib/server/agent-api/http.ts';
import { limits } from '#lib/server/agent-api/rate-limit.ts';
import type { RequestHandler } from './$types';

/** A full batch (500 events) is well under this. Matches adapter-node's default BODY_SIZE_LIMIT. */
const MAX_BODY_BYTES = 512 * 1024;

export const POST: RequestHandler = async (event) => {
	const auth = await authenticateDevice(event);
	if (!auth.ok) return auth.response;
	const device = auth.value;

	const wait = limits.events.take(device.id);
	if (wait) return rateLimited(wait);

	const body = await readJson(event.request, AgentEventBatch, MAX_BODY_BYTES);
	if (!body.ok) return body.response;

	const foreign = body.data.events.findIndex((e) => e.deviceId !== device.deviceId);
	if (foreign !== -1) {
		return apiError(403, 'device_mismatch', 'Every event must carry this device’s deviceId.', {
			issues: [{ path: ['events', foreign, 'deviceId'], message: 'Not the authenticated device.' }]
		});
	}

	const response: EventBatchResponse = { accepted: await storeEvents(device, body.data) };
	return Response.json(response, { headers: { 'cache-control': 'no-store' } });
};
