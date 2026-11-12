<script lang="ts">
	// "What's sensitive": the board of data types Safe Context protects (issue #23). Drag a pill to
	// the other column (or open it and change its column) to change what happens to that data.
	import {
		ACTION_LABELS,
		actionFor,
		type BoardTier,
		COLUMNS,
		isBuiltin,
		shownAction
	} from '#lib/policy-board.ts';
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

	const tones = {
		vague: { column: 'bg-lemon/35', pill: 'bg-lemon', ring: 'ring-lemon' },
		never: { column: 'bg-pink/35', pill: 'bg-pink', ring: 'ring-pink' }
	} as const;

	/** "Placeholder only · 3 words · built-in" */
	function detail(dt: DataTypeView): string {
		const parts: string[] = [];
		parts.push(ACTION_LABELS[shownAction(dt.tier, dt.action)].label);
		if (dt.terms.length > 0)
			parts.push(`${dt.terms.length} ${dt.terms.length === 1 ? 'word' : 'words'}`);
		if (isBuiltin(dt.key)) parts.push('built-in');
		return parts.join(' · ');
	}

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
			class="flex min-h-48 flex-col rounded-2xl p-4 transition-shadow {tones[column.tone]
				.column} {over === column.tier ? `ring-2 ring-offset-2 ${tones[column.tone].ring}` : ''}"
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
			<h3 id="column-{column.tier}" class="flex items-center gap-2 text-base font-semibold">
				<span class="size-3 rounded-full {tones[column.tone].pill} ring-1 ring-ink/20"></span>
				{column.title}
				<span class="ml-auto text-sm font-normal text-ink/60">{items.length}</span>
			</h3>
			<p class="mt-1 mb-3 text-sm text-ink/70">{column.summary}</p>

			<ul class="flex flex-wrap content-start gap-2">
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
							class="flex max-w-full flex-col items-start rounded-2xl px-3 py-1.5 text-left shadow-sm ring-1 ring-ink/10 hover:ring-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink {tones[
								column.tone
							].pill} {canEdit ? 'cursor-grab active:cursor-grabbing' : ''}"
							data-testid="pill-{dt.key}"
							onclick={() => onopen({ mode: 'edit', dataType: dt })}
						>
							<span class="text-sm font-semibold">{dt.name}</span>
							{#if detail(dt)}
								<span class="text-xs text-ink/70">{detail(dt)}</span>
							{/if}
						</button>
					</li>
				{/each}
			</ul>

			{#if canEdit}
				<button
					type="button"
					class="mt-3 w-fit rounded-full border border-dashed border-ink/30 px-3 py-1.5 text-sm font-semibold text-ink/80 hover:border-ink/60 hover:bg-white/60"
					onclick={() => onopen({ mode: 'add', tier: column.tier })}
				>
					+ Add data type
				</button>
			{/if}
		</section>
	{/each}
</div>
