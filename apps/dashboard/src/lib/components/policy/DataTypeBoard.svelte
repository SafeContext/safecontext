<script lang="ts">
	// "What's sensitive": the board of data types Safe Context protects (issue #23, restyled in
	// #96). Drag a row to the other column (or open it and change its column) to change what happens
	// to that data. Adding one is the page's "Add data type" button.
	import {
		ACTION_LABELS,
		actionFor,
		type BoardTier,
		COLUMNS,
		isBuiltin,
		shownAction
	} from '#lib/policy-board.ts';
	import Icon from '#lib/components/ui/Icon.svelte';
	import ResultKey from '#lib/components/ui/ResultKey.svelte';
	import { TIER_TONE, TONE_CLASSES } from '#lib/tones.ts';
	import type { DataTypeView, Target } from './DataTypeDialog.svelte';
	import { send } from './send.ts';

	let {
		dataTypes,
		canEdit,
		onopen,
		onmessage
	}: {
		dataTypes: DataTypeView[];
		canEdit: boolean;
		onopen: (target: Target) => void;
		onmessage: (message: string, ok: boolean) => void;
	} = $props();

	// Moves show at once; the next page data (after saving) replaces this.
	let shown = $derived(dataTypes);
	let dragging = $state<string | null>(null);
	let over = $state<BoardTier | null>(null);

	/** Panels get a faint tint of their column's brand colour; rows carry the colour itself. */
	const tone = (tier: BoardTier) => TIER_TONE[tier];

	const words = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

	async function drop(tier: BoardTier, before: string | null) {
		const key = dragging;
		dragging = null;
		over = null;
		if (!key || key === before) return;
		const moving = shown.find((d) => d.key === key);
		if (!moving) return;
		const rest = shown.filter((d) => d.key !== key);
		const moved = { ...moving, tier, action: actionFor(tier, moving.action) };
		// Only the order within a column matters (each column filters this list).
		const at = before ? rest.findIndex((d) => d.key === before) : -1;
		rest.splice(at === -1 ? rest.length : at, 0, moved);
		const previous = shown;
		shown = rest;
		const result = await send('move', { key, tier, before: before ?? '' });
		if (!result.ok) {
			shown = previous;
			onmessage(result.message, false);
		}
	}
</script>

<div class="grid gap-4 md:grid-cols-2">
	{#each COLUMNS as column (column.tier)}
		{@const items = shown.filter((d) => d.tier === column.tier)}
		<section
			class="flex flex-col gap-2.5 rounded-xl border p-3.5 transition-colors {TONE_CLASSES[
				tone(column.tier)
			].panel} {over === column.tier ? 'ring-2 ring-ink/30' : ''}"
			aria-labelledby="column-{column.tier}"
			data-testid="column-{column.tier}"
			ondragover={(e) => {
				if (!dragging) return;
				e.preventDefault();
				over = column.tier;
			}}
			ondragleave={(e) => {
				if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) over = null;
			}}
			ondrop={(e) => {
				e.preventDefault();
				drop(column.tier, null);
			}}
		>
			<div class="flex items-start gap-2.5 px-1 pt-0.5 pb-1.5">
				<ResultKey tone={tone(column.tier)} class="mt-[5px]" />
				<span class="flex min-w-0 flex-col">
					<h3 id="column-{column.tier}" class="font-sans text-[15px] font-bold tracking-normal">
						{column.title}
					</h3>
					<span class="text-[13px] text-muted">{column.summary}</span>
				</span>
				<span class="ml-auto pt-0.5 font-mono text-[13px] text-subtle">{items.length}</span>
			</div>

			<ul class="flex flex-col gap-2">
				{#each items as dt (dt.key)}
					<li
						draggable={canEdit}
						class={dragging === dt.key ? 'opacity-40' : ''}
						ondragstart={(e) => {
							dragging = dt.key;
							e.dataTransfer?.setData('text/plain', dt.name);
							if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
						}}
						ondragend={() => {
							dragging = null;
							over = null;
						}}
						ondragover={(e) => {
							if (!dragging) return;
							e.preventDefault();
							over = column.tier;
						}}
						ondrop={(e) => {
							e.preventDefault();
							e.stopPropagation();
							drop(column.tier, dt.key);
						}}
					>
						<button
							type="button"
							class="flex w-full items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left {TONE_CLASSES[
								tone(column.tier)
							]
								.row} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink
								{canEdit ? 'cursor-grab active:cursor-grabbing' : ''}"
							data-testid="pill-{dt.key}"
							onclick={() => onopen({ mode: 'edit', dataType: dt })}
						>
							{#if canEdit}
								<Icon name="grip" class="size-3.5 shrink-0 text-ink/40" />
							{/if}
							<span class="flex min-w-0 flex-1 flex-col gap-0.5">
								<span class="truncate text-sm font-semibold">{dt.name}</span>
								<span class="truncate text-xs text-muted"
									>{ACTION_LABELS[shownAction(dt.tier, dt.action)].label}</span
								>
							</span>
							{#if dt.terms.length > 0}
								<span
									class="shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-xs whitespace-nowrap text-subtle"
									>{words(dt.terms.length)}</span
								>
							{/if}
							{#if isBuiltin(dt.key)}
								<span
									class="flex shrink-0 items-center gap-1 text-xs whitespace-nowrap text-subtle"
									title="Built in: can move, can't be deleted"
								>
									<Icon name="lock" class="size-3.5" />Built in
								</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>
			{#if items.length === 0}
				<p
					class="rounded-[10px] border border-dashed border-field px-3 py-4 text-center text-sm text-muted"
				>
					{canEdit ? 'Drag a data type here' : 'Nothing here'}
				</p>
			{/if}
		</section>
	{/each}
</div>
