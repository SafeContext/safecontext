<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pill from '#lib/components/Pill.svelte';
</script>

<svelte:head>
	<title>Overview · Safe Context</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="text-3xl font-bold">Overview</h1>
	<Pill>Coming soon</Pill>
</div>
<p class="mb-6 max-w-2xl text-ink/70">A live view of how your organisation uses Claude Code.</p>

<Card>
	<EmptyState
		title="Nothing to show yet"
		description="Activity will appear here once Safe Context is deployed to your team."
	>
		{#snippet action()}
			<Button variant="secondary" href={resolve('/deploy')}>Go to Deploy</Button>
		{/snippet}
	</EmptyState>
</Card>
