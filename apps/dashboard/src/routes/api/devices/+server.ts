// POST /api/devices: a device joins the organisation and gets its id and token (issues #21, #51).
// Auth: the organisation's enrollment key (`Authorization: Bearer sce_...`).
//
// The dashboard picks the device id, so every registration is a new device: holding the key
// never lets anyone take over a device that has already joined, and revoking a device stops its
// token for good. A Mac that loses its Keychain item joins again as a new device.
import { DeviceRegistrationRequest, type DeviceRegistrationResponse } from '@safecontext/policy';
import { authenticateEnrollment } from '#lib/server/agent-api/auth.ts';
import { rateLimited, readJson } from '#lib/server/agent-api/http.ts';
import { limits } from '#lib/server/agent-api/rate-limit.ts';
import { hashSecret, newDeviceId, newSecret } from '#lib/server/agent-api/secrets.ts';
import { prisma } from '#lib/server/prisma.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async (event) => {
	const wait = limits.register.take(event.getClientAddress());
	if (wait) return rateLimited(wait);

	const org = await authenticateEnrollment(event);
	if (!org.ok) return org.response;

	const body = await readJson(event.request, DeviceRegistrationRequest, 4 * 1024);
	if (!body.ok) return body.response;

	const deviceId = newDeviceId();
	const token = newSecret('deviceToken');
	await prisma.device.create({
		data: {
			organizationId: org.value.id,
			deviceId,
			label: body.data.label ?? null,
			tokenHash: hashSecret(token),
			tokenIssuedAt: new Date()
		}
	});

	const response: DeviceRegistrationResponse = { deviceId, token };
	return Response.json(response, { status: 201, headers: { 'cache-control': 'no-store' } });
};
