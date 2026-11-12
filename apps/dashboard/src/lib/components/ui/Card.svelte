<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		actions,
		children,
		class: className = ''
	}: {
		title?: string;
		/** A line under the title. */
		description?: string;
		/** Things on the right of the title, such as a link or button. */
		actions?: Snippet;
		children: Snippet;
		class?: string;
	} = $props();
</script>

<section
	class="flex flex-col gap-4 rounded-2xl border border-line bg-white px-5 py-5 sm:px-6 {className}"
>
	{#if title}
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h2 class="text-xl font-bold">{title}</h2>
				{#if description}
					<p class="mt-1 text-sm text-muted">{description}</p>
				{/if}
			</div>
			{#if actions}
				<div class="flex flex-wrap items-center gap-3">{@render actions()}</div>
			{/if}
		</div>
	{/if}
	{@render children()}
</section>
