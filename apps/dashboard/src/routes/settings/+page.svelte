<script lang="ts">
	// Settings (#51): the devices in the organisation and the key they join with.
	import { onMount } from 'svelte';
	import DeviceList from '#lib/components/settings/DeviceList.svelte';
	import EnrollmentKeyCard from '#lib/components/settings/EnrollmentKeyCard.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let notice = $state<{ text: string; ok: boolean } | null>(null);
	let now = $state(Date.now());

	function say(text: string, ok: boolean) {
		notice = { text, ok };
	}

	onMount(() => {
		const tick = setInterval(() => (now = Date.now()), 30_000);
		return () => clearInterval(tick);
	});

	const summary = $derived(
		data.total === 0
			? 'No devices have joined yet.'
			: `${data.active} active of ${data.total}.` +
					(data.total > data.devices.length
						? ` Showing the ${data.devices.length} seen most recently.`
						: '')
	);
</script>

<svelte:head>
	<title>Settings · Safe Context</title>
</svelte:head>

<PageHeader eyebrow="Organisation" title="Settings" />
<p class="-mt-2 max-w-2xl text-muted">
	The devices in your organisation, and the key they join with.
</p>

<div aria-live="polite" class="empty:hidden">
	{#if notice}
		<p
			class="flex items-start justify-between gap-3 rounded-[10px] px-3.5 py-2 text-sm text-ink {notice.ok
				? 'bg-clean'
				: 'bg-blocked'}"
			data-testid="notice"
		>
			{notice.text}
			<button type="button" class="shrink-0 font-semibold underline" onclick={() => (notice = null)}
				>Dismiss</button
			>
		</p>
	{/if}
</div>

<EnrollmentKeyCard
	createdAt={data.enrollmentKey?.createdAt ?? null}
	canEdit={data.canEdit}
	{now}
	onmessage={say}
/>

<Card title="Devices" description={summary}>
	{#if data.devices.length === 0}
		<EmptyState
			title="No devices yet"
			description="Devices appear here when their agent joins with the enrollment key."
		/>
	{:else}
		<DeviceList
			devices={data.devices}
			publishedVersion={data.publishedVersion}
			canEdit={data.canEdit}
			{now}
			onmessage={say}
		/>
		<p class="text-xs text-muted">
			Revoking a device stops it getting your policy and sending events. A device that still has the
			enrollment key can join again as a new device, so make a new key as well when a device is lost
			or someone leaves.
		</p>
	{/if}
</Card>
