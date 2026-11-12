// The policy editor (issue #23). Every edit saves to the draft at once; Publish makes it a new
// policy version that agents pick up. Only admins (not viewers) may change anything.
import { error, fail } from '@sveltejs/kit';
import { getRequestEvent } from '$app/server';
import { LOCAL_SWAP_BACK_TOOLS, NEVER_SWAP_BACK_TOOLS } from '@safecontext/policy';
import { isBoardTier } from '#lib/policy-board.ts';
import { currentOrganization } from '#lib/server/current-org.ts';
import {
	addDataType,
	deleteDataType,
	discardDraft,
	DraftError,
	draftStatus,
	loadDraft,
	moveDataType,
	publish,
	saveDataType,
	setFailMode,
	setSwapBackTools
} from '#lib/server/policy-draft.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const org = currentOrganization();
	const draft = await loadDraft(org.id);
	const status = await draftStatus(org.id, draft);
	return {
		draft: {
			...draft,
			// Only what the board shows (no green types: see policy-board.ts).
			dataTypes: draft.dataTypes.flatMap((dt) =>
				isBoardTier(dt.tier) ? [{ ...dt, tier: dt.tier }] : []
			)
		},
		status,
		canEdit: locals.admin?.role === 'admin',
		localTools: [...LOCAL_SWAP_BACK_TOOLS] as string[],
		neverTools: [...NEVER_SWAP_BACK_TOOLS] as string[]
	};
};

/** The signed-in admin, if they may change the policy. */
function editor() {
	const { admin } = getRequestEvent().locals;
	if (!admin) error(401, 'Sign in to change the policy');
	if (admin.role !== 'admin') error(403, 'Only admins can change the policy');
	return { organizationId: admin.organization.id, memberId: admin.memberId };
}

const text = (form: FormData, name: string) => {
	const value = form.get(name);
	return typeof value === 'string' ? value : '';
};

/** Runs an edit; a `DraftError` becomes a message on the page instead of an error page. */
async function edit<T>(run: () => Promise<T>) {
	try {
		return await run();
	} catch (e) {
		if (e instanceof DraftError) return fail(400, { message: e.message });
		throw e;
	}
}

function tier(form: FormData) {
	const value = text(form, 'tier');
	if (!isBoardTier(value)) error(400, 'Unknown column');
	return value;
}

export const actions: Actions = {
	move: async ({ request }) => {
		const { organizationId } = editor();
		const form = await request.formData();
		return edit(() =>
			moveDataType(organizationId, text(form, 'key'), tier(form), text(form, 'before') || null)
		);
	},

	save: async ({ request }) => {
		const { organizationId } = editor();
		const form = await request.formData();
		return edit(() =>
			saveDataType(organizationId, text(form, 'key'), {
				tier: tier(form),
				name: text(form, 'name'),
				description: text(form, 'description'),
				action: text(form, 'action'),
				terms: text(form, 'terms')
			})
		);
	},

	add: async ({ request }) => {
		const { organizationId } = editor();
		const form = await request.formData();
		return edit(async () => ({
			added: await addDataType(organizationId, tier(form), {
				name: text(form, 'name'),
				description: text(form, 'description'),
				terms: text(form, 'terms')
			})
		}));
	},

	delete: async ({ request }) => {
		const { organizationId } = editor();
		const form = await request.formData();
		return edit(() => deleteDataType(organizationId, text(form, 'key')));
	},

	swapBack: async ({ request }) => {
		const { organizationId } = editor();
		const form = await request.formData();
		const tools = form.getAll('tool').filter((t): t is string => typeof t === 'string');
		return edit(() => setSwapBackTools(organizationId, tools));
	},

	failMode: async ({ request }) => {
		const { organizationId } = editor();
		const form = await request.formData();
		return edit(() => setFailMode(organizationId, text(form, 'failMode')));
	},

	publish: async () => {
		const { organizationId, memberId } = editor();
		return edit(async () => ({ published: await publish(organizationId, memberId) }));
	},

	discard: async () => {
		const { organizationId } = editor();
		return edit(() => discardDraft(organizationId));
	}
};
