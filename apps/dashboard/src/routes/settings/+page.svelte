<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import Pill from '#lib/components/ui/Pill.svelte';
</script>

<svelte:head>
	<title>Settings · Safe Context</title>
</svelte:head>

<PageHeader eyebrow="Organisation" title="Settings">
	<Pill>Coming soon</Pill>
</PageHeader>
<p class="-mt-2 max-w-2xl text-muted">Organisation and account settings.</p>

<Card>
	<EmptyState title="No settings yet" description="Settings are coming soon.">
		{#snippet action()}
			<Button variant="secondary" href={resolve('/')}>Back to Overview</Button>
		{/snippet}
	</EmptyState>
</Card>
