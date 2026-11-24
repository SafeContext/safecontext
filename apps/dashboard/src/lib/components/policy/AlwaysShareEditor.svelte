<script lang="ts">
	// "Always share" (#117): names IT says are fine to share, such as the company's own products
	// and its vendors. The models never flag them; secrets and personal details are still hidden.
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { send } from './send.ts';

	let {
		terms,
		canEdit,
		onmessage
	}: {
		terms: string[];
		canEdit: boolean;
		onmessage: (message: string, ok: boolean) => void;
	} = $props();

	let shown = $derived(terms);
	let adding = $state('');
	let busy = $state(false);

	async function save(next: string[], done: string) {
		const previous = shown;
		shown = next;
		busy = true;
		const result = await send('allow', { term: next });
		busy = false;
		if (!result.ok) {
			shown = previous;
			onmessage(result.message, false);
			return false;
		}
		onmessage(done, true);
		return true;
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		// Several at once: one per line or separated by commas.
		const fresh = adding
			.split(/[\n,]/)
			.map((t) => t.trim())
			.filter((t) => t && !shown.some((s) => s.toLowerCase() === t.toLowerCase()));
		if (fresh.length === 0) return;
		if (await save([...shown, ...fresh], `Added ${fresh.join(', ')}.`)) adding = '';
	}
</script>

{#if shown.length > 0}
	<ul class="flex flex-wrap gap-2" data-testid="always-share">
		{#each shown as term (term)}
			<li
				class="inline-flex max-w-full items-center gap-1 rounded-full border border-clean-edge bg-clean-soft py-1 pr-1 pl-3 text-[13px] {canEdit
					? ''
					: 'pr-3'}"
			>
				<span class="break-all">{term}</span>
				{#if canEdit}
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded-full hover:bg-ink/10"
						aria-label="Remove {term}"
						disabled={busy}
						onclick={() =>
							save(
								shown.filter((t) => t !== term),
								`Removed ${term}.`
							)}
					>
						<Icon name="close" class="size-3.5" />
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="text-sm text-muted">None yet.</p>
{/if}

{#if canEdit}
	<form class="flex flex-wrap gap-2" onsubmit={add}>
		<label class="sr-only" for="always-share-add">Name to always share</label>
		<input
			id="always-share-add"
			class="min-w-0 flex-[1_1_12rem] rounded-[10px] border border-field bg-white px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
			placeholder="Your product, a vendor…"
			autocomplete="off"
			bind:value={adding}
		/>
		<Button type="submit" variant="secondary" disabled={busy || !adding.trim()}>Add</Button>
	</form>
{/if}
<p class="text-xs text-muted">
	Whole names, any capitalisation. Keys, passwords and personal details are still hidden, and so is
	anything on a word list above.
</p>
