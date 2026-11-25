// Settings (issue #51): the organisation's devices and its enrollment key. Everyone signed in can
// see them; only admins can revoke a device or make a new key.
import { error, fail } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { latestPolicy } from '#lib/server/agent-api/policy.ts';
import { currentOrganization } from '#lib/server/current-org.ts';
import {
	DEVICE_LIST_LIMIT,
	enrollmentKeyInfo,
	listDevices,
	revokeDevice,
	rotateEnrollmentKey
} from '#lib/server/devices.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const org = currentOrganization();
	const [list, key, policy] = await Promise.all([
		listDevices(org.id),
		enrollmentKeyInfo(org.id),
		latestPolicy(org.id)
	]);
	return {
		...list,
		limit: DEVICE_LIST_LIMIT,
		enrollmentKey: key,
		publishedVersion: policy?.version ?? null,
		canEdit: locals.admin?.role === 'admin'
	};
};

/** The signed-in admin's organisation, if they may change these settings. */
function adminOrg() {
	const { admin } = getRequestEvent().locals;
	if (!admin) error(401, 'Sign in to change settings');
	if (admin.role !== 'admin') error(403, 'Only admins can change settings');
	return admin.organization.id;
}

export const actions: Actions = {
	revoke: async ({ request }) => {
		const organizationId = adminOrg();
		const id = (await request.formData()).get('id');
		if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) {
			return fail(400, { message: 'Unknown device.' });
		}
		if (!(await revokeDevice(organizationId, id))) {
			return fail(404, { message: 'That device was already revoked, or is not in this organisation.' });
		}
		return { revoked: id };
	},

	rotateKey: async () => {
		const organizationId = adminOrg();
		// Returned once, in this response only. It's never stored, so it can't be shown again.
		return { key: await rotateEnrollmentKey(organizationId) };
	}
};
