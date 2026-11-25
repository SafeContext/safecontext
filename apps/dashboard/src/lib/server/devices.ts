// The organisation's devices and enrollment key, for the Settings page (issue #51).
//
// Devices join with the enrollment key, which IT deploys with their device management tool. The
// dashboard gives each device its own id and token. Revoking a device clears its token, so it can
// no longer pull the policy or send events. A Mac that still has the enrollment key can join
// again as a new device, so rotate the key too when a Mac is lost or leaves the company.
import { hashSecret, newSecret } from '#lib/server/agent-api/secrets.ts';
import { prisma } from '#lib/server/prisma.ts';

/** Most devices the page lists, most recently seen first. */
export const DEVICE_LIST_LIMIT = 500;

/** `no_token`: never had a token, such as the seeded demo devices. It can't sync. */
export type DeviceStatus = 'active' | 'revoked' | 'no_token';

export type DeviceRow = {
	/** `Device.id`: what the page sends back to revoke it. */
	id: string;
	deviceId: string;
	label: string | null;
	firstSeenAt: Date;
	lastSeenAt: Date;
	lastPolicyVersion: number | null;
	status: DeviceStatus;
};

export type DeviceList = { devices: DeviceRow[]; total: number; active: number };

export async function listDevices(organizationId: string): Promise<DeviceList> {
	const [rows, total, active] = await prisma.$transaction([
		prisma.device.findMany({
			where: { organizationId },
			orderBy: [{ lastSeenAt: 'desc' }, { id: 'desc' }],
			take: DEVICE_LIST_LIMIT,
			select: {
				id: true,
				deviceId: true,
				label: true,
				firstSeenAt: true,
				lastSeenAt: true,
				lastPolicyVersion: true,
				tokenHash: true,
				revokedAt: true
			}
		}),
		prisma.device.count({ where: { organizationId } }),
		prisma.device.count({ where: { organizationId, tokenHash: { not: null } } })
	]);
	return {
		devices: rows.map(({ tokenHash, revokedAt, ...d }) => ({
			...d,
			status: revokedAt !== null ? 'revoked' : tokenHash !== null ? 'active' : 'no_token'
		})),
		total,
		active
	};
}

/**
 * Revokes a device of this organisation: its token stops working at once. Returns false if
 * there is no such device here or it was already revoked.
 */
export async function revokeDevice(organizationId: string, id: string): Promise<boolean> {
	const { count } = await prisma.device.updateMany({
		where: { id, organizationId, revokedAt: null },
		data: { tokenHash: null, revokedAt: new Date() }
	});
	return count === 1;
}

export type EnrollmentKeyInfo = { createdAt: Date } | null;

/** When the current key was made, or null if devices can't join yet. The key itself isn't stored. */
export async function enrollmentKeyInfo(organizationId: string): Promise<EnrollmentKeyInfo> {
	const org = await prisma.organization.findUniqueOrThrow({
		where: { id: organizationId },
		select: { enrollmentKeyHash: true, enrollmentKeyCreatedAt: true }
	});
	if (org.enrollmentKeyHash === null) return null;
	return { createdAt: org.enrollmentKeyCreatedAt ?? new Date(0) };
}

/**
 * Makes a new enrollment key and returns it: the only time it can be seen. The old key stops
 * working at once. Devices that have already joined keep working: they use their own tokens.
 */
export async function rotateEnrollmentKey(organizationId: string): Promise<string> {
	const key = newSecret('enrollmentKey');
	await prisma.organization.update({
		where: { id: organizationId },
		data: { enrollmentKeyHash: hashSecret(key), enrollmentKeyCreatedAt: new Date() }
	});
	return key;
}
