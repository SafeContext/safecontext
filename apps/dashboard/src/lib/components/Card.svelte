<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, children }: { title?: string; children: Snippet } = $props();
</script>

<section class="rounded-2xl border border-ink/10 bg-white p-5 shadow-sm sm:p-6">
	{#if title}
		<h2 class="mb-4 text-lg font-semibold">{title}</h2>
	{/if}
	{@render children()}
</section>
