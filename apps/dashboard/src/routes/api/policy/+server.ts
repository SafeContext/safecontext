// GET /api/policy: the latest published policy for the device's organisation (issue #21).
// Auth: device token. Supports `If-None-Match` (304 when unchanged), so polling is cheap.
import { authenticateDevice, touchDevice } from '#lib/server/agent-api/auth.ts';
import { apiError, rateLimited } from '#lib/server/agent-api/http.ts';
import { etagMatches, latestPolicy, policyEtag } from '#lib/server/agent-api/policy.ts';
import { limits } from '#lib/server/agent-api/rate-limit.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async (event) => {
	const auth = await authenticateDevice(event);
	if (!auth.ok) return auth.response;
	const device = auth.value;

	const wait = limits.policy.take(device.id);
	if (wait) return rateLimited(wait);

	const [policy] = await Promise.all([latestPolicy(device.organizationId), touchDevice(device)]);
	if (!policy) {
		return apiError(404, 'no_policy', 'No policy has been published yet. Keep the current one.');
	}

	const etag = policyEtag(policy.version);
	// `no-cache`: caches may store it but must revalidate (with the ETag) every time.
	const headers = { etag, 'cache-control': 'private, no-cache' };
	if (etagMatches(event.request.headers.get('if-none-match'), etag)) {
		return new Response(null, { status: 304, headers });
	}
	return Response.json(policy, { headers });
};
