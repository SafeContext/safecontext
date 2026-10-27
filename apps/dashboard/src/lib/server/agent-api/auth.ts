// Device-token and enrollment-key auth for the agent API. Separate from admin sign-in (#19).
import type { RequestEvent } from '@sveltejs/kit';
import { prisma } from '#lib/server/prisma.ts';
import { apiError, bearer, rateLimited } from './http.ts';
import { limits } from './rate-limit.ts';
import { hashSecret, isSecret, type SecretKind } from './secrets.ts';

export type AuthedDevice = {
	/** `Device.id` (database id). */
	id: string;
	organizationId: string;
	/** The agent's anonymised id (`AgentEvent.deviceId`). */
	deviceId: string;
	lastSeenAt: Date;
};

type Result<T> = { ok: true; value: T } | { ok: false; response: Response };

const unauthorized = (kind: SecretKind) =>
	apiError(
		401,
		'unauthorized',
		kind === 'deviceToken'
			? 'Send a valid device token: Authorization: Bearer <token>.'
			: 'Send a valid enrollment key: Authorization: Bearer <key>.',
		{ headers: { 'www-authenticate': 'Bearer' } }
	);

/**
 * Looks up the secret in the Authorization header. Clients that keep failing are rate-limited
 * by IP before we even look, so guessing is slow as well as hopeless.
 */
async function authenticate<T>(
	event: RequestEvent,
	kind: SecretKind,
	lookup: (hash: string) => Promise<T | null>
): Promise<Result<T>> {
	const ip = event.getClientAddress();
	const wait = limits.authFailures.check(ip);
	if (wait) return { ok: false, response: rateLimited(wait) };

	const secret = bearer(event.request);
	const found = secret && isSecret(kind, secret) ? await lookup(hashSecret(secret)) : null;
	if (!found) {
		limits.authFailures.take(ip);
		return { ok: false, response: unauthorized(kind) };
	}
	return { ok: true, value: found };
}

export function authenticateDevice(event: RequestEvent): Promise<Result<AuthedDevice>> {
	return authenticate(event, 'deviceToken', (tokenHash) =>
		prisma.device.findUnique({
			where: { tokenHash },
			select: { id: true, organizationId: true, deviceId: true, lastSeenAt: true }
		})
	);
}

export function authenticateEnrollment(event: RequestEvent): Promise<Result<{ id: string }>> {
	return authenticate(event, 'enrollmentKey', (enrollmentKeyHash) =>
		prisma.organization.findUnique({ where: { enrollmentKeyHash }, select: { id: true } })
	);
}

/** Marks the device as seen, at most once a minute (agents poll often; avoid a write per poll). */
export async function touchDevice(device: AuthedDevice, now = new Date()): Promise<void> {
	if (now.getTime() - device.lastSeenAt.getTime() < 60_000) return;
	await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: now } });
}
