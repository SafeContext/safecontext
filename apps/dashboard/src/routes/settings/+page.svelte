<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pill from '#lib/components/Pill.svelte';
</script>

<svelte:head>
	<title>Settings · Safe Context</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="text-3xl font-bold">Settings</h1>
	<Pill>Coming soon</Pill>
</div>
<p class="mb-6 max-w-2xl text-ink/70">Organisation and account settings.</p>

<Card>
	<EmptyState title="No settings yet" description="Settings are coming soon.">
		{#snippet action()}
			<Button variant="secondary" href={resolve('/')}>Back to Overview</Button>
		{/snippet}
	</EmptyState>
</Card>
