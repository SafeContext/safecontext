<script lang="ts">
	// A page's title block: a small label above the title, and optional things on the right.
	import type { Snippet } from 'svelte';

	let { eyebrow, title, children }: { eyebrow?: string; title: string; children?: Snippet } =
		$props();
</script>

<header class="flex flex-wrap items-end justify-between gap-4">
	<div>
		{#if eyebrow}
			<p class="mb-1.5 text-[13px] font-semibold tracking-[0.06em] text-muted uppercase">
				{eyebrow}
			</p>
		{/if}
		<h1 class="text-[40px] leading-[1.05] font-bold tracking-[-0.02em]">{title}</h1>
	</div>
	{#if children}
		<div class="flex flex-wrap items-center gap-3">{@render children()}</div>
	{/if}
</header>
