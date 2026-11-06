<script lang="ts">
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Pill from '#lib/components/Pill.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Policy · Safe Context</title>
</svelte:head>

<div class="mb-6 flex flex-wrap items-center gap-3">
	<h1 class="text-3xl font-bold">Policy</h1>
	<Pill>Coming soon</Pill>
</div>
<p class="mb-6 max-w-2xl text-ink/70">Decide what Claude Code is allowed to see.</p>

<div class="flex flex-col gap-6">
	<Card title="Where real values go back">
		{#if data.swapBack}
			<p class="mb-4 max-w-2xl text-sm text-ink/70">
				Claude only sees placeholders such as <code>⟪customer_name_1⟫</code>. When Claude uses one
				of these tools, Safe Context puts the real value back just before the tool runs, on the
				person's Mac. Policy version {data.swapBack.version}.
			</p>

			<h3 class="mb-2 text-sm font-semibold">File tools in the project folder</h3>
			{#if data.swapBack.local.length > 0}
				<ul class="mb-4 flex flex-wrap gap-2" data-testid="swap-back-local">
					{#each data.swapBack.local as tool (tool)}
						<li><Pill tone="safe">{tool}</Pill></li>
					{/each}
				</ul>
			{:else}
				<p class="mb-4 text-sm text-ink/70">None.</p>
			{/if}

			<h3 class="mb-2 text-sm font-semibold">
				Other tools, each call approved by the person first
			</h3>
			{#if data.swapBack.added.length > 0}
				<ul class="mb-4 flex flex-wrap gap-2" data-testid="swap-back-added">
					{#each data.swapBack.added as tool (tool)}
						<li class="max-w-full">
							<code
								class="inline-block rounded-full bg-lemon px-3 py-1 text-xs font-semibold break-all"
								>{tool}</code
							>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="mb-4 text-sm text-ink/70">
					None. MCP tools and shell commands get the placeholder exactly as Claude wrote it.
				</p>
			{/if}

			<p class="text-sm text-ink/70">
				Real values never go into subagents, web fetches or web searches: their input goes to
				Anthropic. Changing this list comes with the policy editor.
			</p>
		{:else}
			<EmptyState
				title="No policy published yet"
				description="Run the database seed to publish the demo policy."
			>
				{#snippet action()}
					<Button variant="secondary" href={resolve('/')}>Back to Overview</Button>
				{/snippet}
			</EmptyState>
		{/if}
	</Card>
</div>
