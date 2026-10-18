<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		action
	}: {
		title: string;
		description?: string;
		/** Optional call to action, usually a `Button`. */
		action?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center gap-3 px-4 py-10 text-center">
	<div class="grid size-12 place-items-center rounded-full bg-lemon" aria-hidden="true">
		<svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M4 7h16M4 12h10M4 17h6" stroke-linecap="round" />
		</svg>
	</div>
	<h3 class="text-xl font-semibold">{title}</h3>
	{#if description}
		<p class="max-w-md text-ink/70">{description}</p>
	{/if}
	{#if action}
		<div class="mt-2">{@render action()}</div>
	{/if}
</div>
