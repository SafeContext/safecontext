<script lang="ts">
	// "Checks per day": one stacked bar per UTC day (nothing found, hidden, blocked). Plain HTML
	// bars, with the numbers in a visually hidden table for screen readers.
	import { RESULT_LABELS, weekday, type DayCounts, type EventResult } from '#lib/feed.ts';
	import { RESULT_TONE, TONE_CLASSES } from '#lib/tones.ts';
	import ResultKey from '#lib/components/ui/ResultKey.svelte';

	let { days }: { days: DayCounts[] } = $props();

	const total = (d: DayCounts) => d.safe + d.vague + d.blocked;
	const max = $derived(Math.max(1, ...days.map(total)));
	/** Share of the chart's height, in %. Any non-zero count shows at least a sliver. */
	const pct = (n: number) => (n === 0 ? 0 : Math.max(1.5, (n / max) * 100));

	const keys = (['safe', 'vague', 'blocked'] as const).map((result) => ({
		result,
		tone: RESULT_TONE[result]
	}));
	const bar = (result: EventResult) => TONE_CLASSES[RESULT_TONE[result]].key;
</script>

<div class="flex flex-col gap-4">
	<ul class="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-subtle" aria-hidden="true">
		{#each keys as k (k.result)}
			<li class="flex items-center gap-1.5">
				<ResultKey tone={k.tone} />{RESULT_LABELS[k.result]}
			</li>
		{/each}
	</ul>

	<div
		class="grid h-48 grid-cols-7 items-end gap-2 border-b border-line sm:gap-3.5"
		aria-hidden="true"
		data-testid="daily-chart"
	>
		{#each days as d (d.day)}
			<div class="flex h-full flex-col justify-end gap-0.5" title="{d.day}: {total(d)} checks">
				{#if d.blocked}<div
						class="rounded-t-[5px] border {bar('blocked')}"
						style="height: {pct(d.blocked)}%"
					></div>{/if}
				{#if d.vague}<div class="border {bar('vague')}" style="height: {pct(d.vague)}%"></div>{/if}
				{#if d.safe}<div
						class="rounded-b-[3px] border {bar('safe')}"
						style="height: {pct(d.safe)}%"
					></div>{/if}
			</div>
		{/each}
	</div>
	<div
		class="-mt-2 grid grid-cols-7 gap-2 text-center text-xs text-muted sm:gap-3.5"
		aria-hidden="true"
	>
		{#each days as d (d.day)}
			<span>{weekday(d.day)}</span>
		{/each}
	</div>

	<table class="sr-only">
		<caption>Checks per day</caption>
		<thead>
			<tr>
				<th scope="col">Day</th>
				{#each keys as k (k.result)}<th scope="col">{RESULT_LABELS[k.result]}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each days as d (d.day)}
				<tr>
					<th scope="row">{d.day}</th>
					<td>{d.safe}</td>
					<td>{d.vague}</td>
					<td>{d.blocked}</td>
				</tr>
			{/each}
		</tbody>
	</table>
</div>
