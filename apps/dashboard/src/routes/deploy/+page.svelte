<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pill from '#lib/components/Pill.svelte';
</script>

<svelte:head>
	<title>Deploy · Safe Context</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="text-3xl font-bold">Deploy</h1>
	<Pill>Coming soon</Pill>
</div>
<p class="mb-6 max-w-2xl text-ink/70">Roll Safe Context out to your team.</p>

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
