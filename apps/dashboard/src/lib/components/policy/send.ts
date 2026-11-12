// Sends one policy edit to the Policy page's form actions (`routes/policy/+page.server.ts`) and
// reloads the page data, so every part of the page shows the saved draft.
import { deserialize } from '$app/forms';
import { refreshAll } from '$app/navigation';

export type Sent = { ok: true; data?: Record<string, unknown> } | { ok: false; message: string };

export async function send(
	action: string,
	body: FormData | Record<string, string | string[]>
): Promise<Sent> {
	const form = body instanceof FormData ? body : toFormData(body);
	let res: Response;
	try {
		res = await fetch(`?/${action}`, {
			method: 'POST',
			body: form,
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
	} catch {
		return {
			ok: false,
			message: "Couldn't reach the dashboard. Check your connection and try again."
		};
	}
	const result = deserialize(await res.text());
	switch (result.type) {
		case 'success':
			await refreshAll();
			return { ok: true, data: result.data };
		case 'failure':
			await refreshAll();
			return {
				ok: false,
				message: String(result.data?.['message'] ?? "That change wasn't saved.")
			};
		case 'error':
			return {
				ok: false,
				message:
					result.status === 403
						? 'Only admins can change the policy.'
						: "That change wasn't saved. Reload the page and try again."
			};
		default:
			// A redirect means the session ended.
			return { ok: false, message: 'You were signed out. Sign in again to keep editing.' };
	}
}

function toFormData(fields: Record<string, string | string[]>): FormData {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) {
		for (const v of Array.isArray(value) ? value : [value]) form.append(name, v);
	}
	return form;
}
