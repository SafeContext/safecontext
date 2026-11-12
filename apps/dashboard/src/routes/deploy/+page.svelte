<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import Pill from '#lib/components/Pill.svelte';
</script>

<svelte:head>
	<title>Deploy · Safe Context</title>
</svelte:head>

<PageHeader eyebrow="Roll out" title="Deploy">
	<Pill>Coming soon</Pill>
</PageHeader>
<p class="-mt-2 max-w-2xl text-muted">Roll Safe Context out to your team.</p>

<Card>
	<EmptyState
		title="Nothing to deploy yet"
		description="Setup instructions for Claude Code are coming soon."
	>
		{#snippet action()}
			<Button variant="secondary" href={resolve('/policy')}>View Policy</Button>
		{/snippet}
	</EmptyState>
</Card>
