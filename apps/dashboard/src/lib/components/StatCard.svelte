<script lang="ts">
	/** Dot colour: `safe` = mint, `vague` = lemon, `never` = pink, `neutral` = ink. */
	type Tone = 'neutral' | 'safe' | 'vague' | 'never';

	let {
		label,
		value,
		tone = 'neutral',
		hint
	}: { label: string; value: number; tone?: Tone; hint?: string } = $props();

	const dots: Record<Tone, string> = {
		neutral: 'bg-ink',
		safe: 'bg-mint',
		vague: 'bg-lemon',
		never: 'bg-pink'
	};

	const format = new Intl.NumberFormat('en-GB');
</script>

<section
	class="flex flex-col gap-2 rounded-2xl border border-ink/10 bg-white p-5 shadow-sm"
	aria-label={label}
>
	<h3 class="flex items-center gap-2 font-sans text-sm font-semibold tracking-normal text-ink/70">
		<span class="size-2.5 rounded-full {dots[tone]}" aria-hidden="true"></span>
		{label}
	</h3>
	<p class="font-heading text-4xl font-bold tracking-tight tabular-nums" data-testid="stat-value">
		{format.format(value)}
	</p>
	{#if hint}
		<p class="text-xs text-ink/60">{hint}</p>
	{/if}
</section>
