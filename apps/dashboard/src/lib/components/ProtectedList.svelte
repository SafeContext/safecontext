<script lang="ts">
	// "What was protected": items found per data type, as labelled bars. Counts only.
	import type { ProtectedCount } from '#lib/feed.ts';
	import ResultKey from './ResultKey.svelte';

	let { types }: { types: ProtectedCount[] } = $props();

	const max = $derived(Math.max(1, ...types.map((t) => t.count)));
	const format = new Intl.NumberFormat('en-GB');
	const tone = (tier: ProtectedCount['tier']) =>
		tier === 'yellow' ? 'hidden' : tier === 'green' ? 'clean' : 'blocked';
	const bar = {
		clean: 'bg-clean border-clean-edge',
		hidden: 'bg-hidden border-hidden-edge',
		blocked: 'bg-blocked border-blocked-edge'
	} as const;
</script>

{#if types.length}
	<ul class="flex flex-col gap-3.5" data-testid="protected-list">
		{#each types as t (t.key)}
			<li class="flex flex-col gap-1.5">
				<span class="flex justify-between gap-3 text-sm">
					<span class="flex min-w-0 items-center gap-2 font-semibold">
						<ResultKey tone={tone(t.tier)} />
						<span class="truncate">{t.name}</span>
					</span>
					<span class="font-mono text-subtle tabular-nums">{format.format(t.count)}</span>
				</span>
				<span class="h-2 overflow-hidden rounded-full bg-[#eeeff4]" aria-hidden="true">
					<span
						class="block h-full rounded-full border {bar[tone(t.tier)]}"
						style="width: {Math.max(2, (t.count / max) * 100)}%"
					></span>
				</span>
			</li>
		{/each}
	</ul>
{:else}
	<p class="text-sm text-muted">Nothing sensitive found in the last 7 days.</p>
{/if}
