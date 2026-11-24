<script lang="ts">
	// A list of names on the Policy page, edited as chips: "Always share" (#117) and "Skills that
	// may run commands" (#42). Each change is saved to the draft straight away.
	import Button from '#lib/components/ui/Button.svelte';
	import Icon from '#lib/components/ui/Icon.svelte';
	import { send } from './send.ts';

	let {
		names,
		action,
		label,
		placeholder,
		testid,
		chipClass = 'border-clean-edge bg-clean-soft',
		canEdit,
		onmessage
	}: {
		names: string[];
		/** The page's form action that saves the whole list (`name` fields). */
		action: string;
		/** Label for the add field (read by screen readers). */
		label: string;
		placeholder: string;
		testid: string;
		chipClass?: string;
		canEdit: boolean;
		onmessage: (message: string, ok: boolean) => void;
	} = $props();

	let shown = $derived(names);
	let adding = $state('');
	let busy = $state(false);
	const id = $derived(`${testid}-add`);

	async function save(next: string[], done: string) {
		const previous = shown;
		shown = next;
		busy = true;
		const result = await send(action, { name: next });
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
	<ul class="flex flex-wrap gap-2" data-testid={testid}>
		{#each shown as name (name)}
			<li
				class="inline-flex max-w-full items-center gap-1 rounded-full border py-1 pr-1 pl-3 text-[13px] {chipClass} {canEdit
					? ''
					: 'pr-3'}"
			>
				<span class="break-all">{name}</span>
				{#if canEdit}
					<button
						type="button"
						class="grid size-7 shrink-0 place-items-center rounded-full hover:bg-ink/10"
						aria-label="Remove {name}"
						disabled={busy}
						onclick={() =>
							save(
								shown.filter((t) => t !== name),
								`Removed ${name}.`
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
		<label class="sr-only" for={id}>{label}</label>
		<input
			{id}
			class="min-w-0 flex-[1_1_12rem] rounded-[10px] border border-field bg-white px-3 py-2 text-[13px] focus:border-ink focus:outline-none"
			{placeholder}
			autocomplete="off"
			bind:value={adding}
		/>
		<Button type="submit" variant="secondary" disabled={busy || !adding.trim()}>Add</Button>
	</form>
{/if}
