<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pill from '#lib/components/Pill.svelte';
</script>

<svelte:head>
	<title>Policy · Safe Context</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="text-3xl font-bold">Policy</h1>
	<Pill>Coming soon</Pill>
</div>
<p class="mb-6 max-w-2xl text-ink/70">Decide what Claude Code is allowed to see.</p>

<Card>
	<EmptyState title="No policy yet" description="The policy editor is coming soon.">
		{#snippet action()}
			<Button variant="secondary" href={resolve('/')}>Back to Overview</Button>
		{/snippet}
	</EmptyState>
</Card>
