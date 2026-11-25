<script lang="ts">
	// The enrollment key devices use to join the organisation (#51). Only its hash is stored, so a
	// new key is shown once, right after it's made.
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import { timeAgo } from '#lib/feed.ts';
	import { send } from '#lib/send.ts';

	let {
		createdAt,
		canEdit,
		now,
		onmessage
	}: {
		/** When the current key was made; null if there is none yet. */
		createdAt: Date | null;
		canEdit: boolean;
		/** Drives the "4 min ago" label. */
		now: number;
		onmessage: (message: string, ok: boolean) => void;
	} = $props();

	let key = $state<string | null>(null);
	let busy = $state(false);
	let copied = $state(false);

	async function rotate() {
		if (
			createdAt &&
			!confirm(
				'Make a new enrollment key? The current key stops working at once, so devices that haven’t joined yet need the new one. Devices that already joined keep working.'
			)
		) {
			return;
		}
		busy = true;
		const result = await send('rotateKey', {});
		busy = false;
		if (!result.ok) return onmessage(result.message, false);
		key = String(result.data?.['key']);
		copied = false;
		onmessage('New enrollment key made. Copy it now: it can’t be shown again.', true);
	}

	async function copy() {
		if (!key) return;
		await navigator.clipboard.writeText(key);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<Card
	title="Enrollment key"
	description="Devices use it once, to join your organisation. Deploy it with your device management tool."
>
	{#snippet actions()}
		{#if canEdit}
			<Button
				variant={createdAt ? 'secondary' : 'primary'}
				onclick={rotate}
				disabled={busy}
				data-testid="rotate-key"
			>
				{createdAt ? 'Make a new key' : 'Make a key'}
			</Button>
		{/if}
	{/snippet}

	{#if key}
		<div class="flex flex-col gap-2 rounded-xl bg-well p-4" data-testid="new-key">
			<p class="text-sm font-semibold">Copy this key now. It can’t be shown again.</p>
			<div class="flex flex-wrap items-center gap-2">
				<code class="min-w-0 flex-1 font-mono text-xs break-all select-all">{key}</code>
				<Button variant="secondary" onclick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
			</div>
		</div>
	{/if}

	<p class="text-sm" data-testid="key-status">
		{#if createdAt}
			The current key was made
			<time datetime={createdAt.toISOString()}>{timeAgo(createdAt.toISOString(), now)}</time>.
		{:else}
			There’s no key yet, so no device can join.
			{canEdit ? 'Make one to start.' : 'Ask an admin to make one.'}
		{/if}
	</p>
	<p class="text-xs text-muted">
		Give the key to the agent on each device as <code>SC_ENROLLMENT_KEY</code>, and optionally a
		name for the device as <code>SC_DEVICE_LABEL</code>, such as its asset tag. Each device gets its
		own token when it joins, so a new key doesn’t affect devices that have already joined.
	</p>
</Card>
