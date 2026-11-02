// POST /api/devices: the agent registers its device and gets a device token (issue #21).
// Auth: the organisation's enrollment key (`Authorization: Bearer sce_...`).
import { DeviceRegistrationRequest, type DeviceRegistrationResponse } from '@safecontext/policy';
import { authenticateEnrollment } from '#lib/server/agent-api/auth.ts';
import { rateLimited, readJson } from '#lib/server/agent-api/http.ts';
import { limits } from '#lib/server/agent-api/rate-limit.ts';
import { hashSecret, newSecret } from '#lib/server/agent-api/secrets.ts';
import { prisma } from '#lib/server/prisma.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const wait = limits.register.take(event.getClientAddress());
	if (wait) return rateLimited(wait);

	const org = await authenticateEnrollment(event);
	if (!org.ok) return org.response;

	const body = await readJson(event.request, DeviceRegistrationRequest, 4 * 1024);
	if (!body.ok) return body.response;
	const { deviceId } = body.data;

	const token = newSecret('deviceToken');
	const now = new Date();
	const key = { organizationId_deviceId: { organizationId: org.value.id, deviceId } };
	const existed = (await prisma.device.count({ where: key.organizationId_deviceId })) > 0;
	// Registering again (e.g. a reinstall that lost the Keychain item) replaces the old token.
	await prisma.device.upsert({
		where: key,
		create: {
			organizationId: org.value.id,
			deviceId,
			tokenHash: hashSecret(token),
			tokenIssuedAt: now
		},
		update: { tokenHash: hashSecret(token), tokenIssuedAt: now, lastSeenAt: now }
	});

	const response: DeviceRegistrationResponse = { deviceId, token };
	return Response.json(response, {
		status: existed ? 200 : 201,
		headers: { 'cache-control': 'no-store' }
	});
};
