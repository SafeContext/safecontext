<script lang="ts">
	import type { Tone } from '#lib/tones.ts';
	import ResultKey from '#lib/components/ui/ResultKey.svelte';

	let {
		label,
		value,
		tone = 'neutral',
		hint
	}: { label: string; value: number; tone?: Tone; hint?: string } = $props();

	const format = new Intl.NumberFormat('en-GB');
</script>

<section
	class="flex flex-col gap-2.5 rounded-2xl border border-line bg-white px-5 py-5"
	aria-label={label}
>
	<h3 class="flex items-center gap-2 font-sans text-sm font-semibold tracking-normal text-subtle">
		<ResultKey {tone} />
		{label}
	</h3>
	<p
		class="font-heading text-[40px] leading-none font-bold tracking-[-0.02em] tabular-nums"
		data-testid="stat-value"
	>
		{format.format(value)}
	</p>
	{#if hint}
		<p class="text-[13px] text-muted">{hint}</p>
	{/if}
</section>
