<script lang="ts">
	// The panel for one data type: open a pill to edit it, or "Add" to make one (issue #23).
	// Also the way to move a pill without dragging (keyboard, touch screens): change its column.
	import { onMount, untrack } from 'svelte';
	import type { Action } from '@safecontext/policy';
	import Button from '#lib/components/Button.svelte';
	import {
		ACTION_LABELS,
		actionFor,
		type BoardTier,
		COLUMNS,
		columnFor,
		csvFirstColumn,
		isBuiltin,
		LIMITS,
		parseTerms,
		shownAction
	} from '#lib/policy-board.ts';
	import { send } from './send.ts';

	export type DataTypeView = {
		key: string;
		name: string;
		description: string;
		tier: BoardTier;
		action: Action;
		terms: string[];
	};

	export type Target = { mode: 'edit'; dataType: DataTypeView } | { mode: 'add'; tier: BoardTier };

	let {
		target,
		canEdit,
		onclose,
		ondone
	}: {
		target: Target;
		canEdit: boolean;
		onclose: () => void;
		/** After a successful save, add or delete, with a line for the page's status message. */
		ondone: (message: string) => void;
	} = $props();

	const start = untrack(() =>
		target.mode === 'edit'
			? { ...target.dataType, action: shownAction(target.dataType.tier, target.dataType.action) }
			: {
					key: '',
					name: '',
					description: '',
					tier: target.tier,
					action: columnFor(target.tier).actions[0]!,
					terms: []
				}
	);
	const editing = untrack(() => target.mode === 'edit');
	const builtin = isBuiltin(start.key);

	let name = $state(start.name);
	let description = $state(start.description);
	let tier = $state<BoardTier>(start.tier);
	let action = $state<Action>(start.action);
	let terms = $state(start.terms.join('\n'));
	let message = $state('');
	let busy = $state(false);

	const column = $derived(columnFor(tier));
	const termCount = $derived(parseTerms(terms).length);

	let dialog: HTMLDialogElement;
	onMount(() => dialog.showModal());

	function changeColumn(next: BoardTier) {
		tier = next;
		action = shownAction(next, actionFor(next, start.tier === next ? start.action : action));
	}

	async function upload(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		const added = csvFirstColumn(await file.text());
		terms = [terms.trim(), added].filter(Boolean).join('\n');
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		message = '';
		const form = new FormData(event.currentTarget as HTMLFormElement);
		const result = editing ? await send('save', form) : await send('add', form);
		busy = false;
		if (!result.ok) {
			message = result.message;
			return;
		}
		ondone(editing ? `Saved “${name.trim()}”.` : `Added “${name.trim()}” to ${column.title}.`);
	}

	async function remove() {
		if (!confirm(`Delete “${start.name}”? Safe Context stops looking for it once you publish.`)) {
			return;
		}
		busy = true;
		const result = await send('delete', { key: start.key });
		busy = false;
		if (!result.ok) {
			message = result.message;
			return;
		}
		ondone(`Deleted “${start.name}”.`);
	}

	const TERMS_EXAMPLE = 'Project Atlas\nNorthwind';

	const field =
		'rounded-xl border border-ink/20 bg-white px-3 py-2 text-base font-normal focus:border-ink focus:outline-none disabled:bg-ink/5';
</script>

<dialog
	bind:this={dialog}
	onclose={() => onclose()}
	class="m-auto w-[min(36rem,calc(100vw-2rem))] rounded-2xl border border-ink/10 bg-white p-0 text-ink shadow-xl backdrop:bg-ink/40"
	aria-labelledby="data-type-title"
>
	<form class="flex max-h-[85dvh] flex-col" onsubmit={submit}>
		<div class="flex items-start justify-between gap-3 border-b border-ink/10 px-5 py-4">
			<div>
				<h2 id="data-type-title" class="text-lg font-semibold">
					{editing ? start.name : `Add to ${column.title}`}
				</h2>
				{#if builtin}
					<p class="text-sm text-ink/70">
						Found by Safe Context's built-in rules. You can move it, but not delete it.
					</p>
				{/if}
			</div>
			<button
				type="button"
				class="grid size-9 shrink-0 place-items-center rounded-full hover:bg-ink/5"
				aria-label="Close"
				onclick={() => dialog.close()}
			>
				<svg viewBox="0 0 24 24" class="size-5" fill="none" stroke="currentColor" stroke-width="2">
					<path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
				</svg>
			</button>
		</div>

		<div class="flex flex-col gap-4 overflow-y-auto px-5 py-4">
			<input type="hidden" name="key" value={start.key} />

			<label class="flex flex-col gap-1.5 text-sm font-medium">
				Name
				<input
					class={field}
					name="name"
					required
					maxlength={LIMITS.name}
					disabled={!canEdit}
					bind:value={name}
				/>
				<span class="text-xs font-normal text-ink/60">
					Safe Context's AI model looks for this data by its name, so make it plain and specific
					(“Patient records”, not “PR”).
				</span>
			</label>

			<label class="flex flex-col gap-1.5 text-sm font-medium">
				Description
				<textarea
					class="{field} min-h-16"
					name="description"
					rows="2"
					maxlength={LIMITS.description}
					disabled={!canEdit}
					bind:value={description}></textarea>
			</label>

			<label class="flex flex-col gap-1.5 text-sm font-medium">
				Column
				<select
					class={field}
					name="tier"
					disabled={!canEdit}
					value={tier}
					onchange={(e) => changeColumn((e.currentTarget as HTMLSelectElement).value as BoardTier)}
				>
					{#each COLUMNS as c (c.tier)}
						<option value={c.tier}>{c.title}</option>
					{/each}
				</select>
				<span class="text-xs font-normal text-ink/60">{column.summary}</span>
			</label>

			{#if column.actions.length > 1}
				<fieldset class="flex flex-col gap-2">
					<legend class="mb-1.5 text-sm font-medium">What Claude sees instead</legend>
					{#each column.actions as a (a)}
						<label
							class="flex cursor-pointer items-start gap-3 rounded-xl border border-ink/15 px-3 py-2 has-checked:border-ink has-checked:bg-ink/5"
						>
							<input
								type="radio"
								name="action"
								value={a}
								class="mt-1"
								disabled={!canEdit}
								bind:group={action}
							/>
							<span class="flex flex-col">
								<span class="text-sm font-medium">{ACTION_LABELS[a].label}</span>
								<code class="text-xs text-ink/70">{ACTION_LABELS[a].example}</code>
							</span>
						</label>
					{/each}
				</fieldset>
			{:else}
				<input type="hidden" name="action" value={column.actions[0]} />
			{/if}

			<div class="flex flex-col gap-1.5">
				<div class="flex items-center justify-between gap-3">
					<label for="terms" class="text-sm font-medium">Word list</label>
					<span class="text-xs text-ink/60" data-testid="term-count">
						{termCount}
						{termCount === 1 ? 'entry' : 'entries'}
					</span>
				</div>
				<textarea
					id="terms"
					class="{field} min-h-28 font-mono text-sm"
					name="terms"
					rows="5"
					placeholder={TERMS_EXAMPLE}
					disabled={!canEdit}
					bind:value={terms}></textarea>
				<span class="text-xs text-ink/60">
					Exact words or names to catch, one per line (capitals don't matter). This is the most
					reliable way to catch something.
				</span>
				{#if canEdit}
					<label
						class="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-ink/20 px-4 py-1.5 text-sm font-semibold hover:bg-ink/5"
					>
						Add from a CSV file
						<input type="file" accept=".csv,text/csv,.txt" class="sr-only" onchange={upload} />
					</label>
				{/if}
				{#if !builtin && termCount === 0}
					<p class="rounded-xl bg-lemon/50 px-3 py-2 text-xs" data-testid="no-words-warning">
						With no word list, only Safe Context's AI model looks for this, by its name. How well it
						finds a new kind of data varies, so add the exact words you know of.
					</p>
				{/if}
			</div>

			{#if message}
				<p class="rounded-xl bg-pink/50 px-3 py-2 text-sm" role="alert">{message}</p>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-2 border-t border-ink/10 px-5 py-4">
			{#if canEdit && editing && !builtin}
				<Button variant="ghost" class="text-red-700" disabled={busy} onclick={remove}>Delete</Button
				>
			{/if}
			<div class="ml-auto flex gap-2">
				<Button variant="secondary" onclick={() => dialog.close()}>
					{canEdit ? 'Cancel' : 'Close'}
				</Button>
				{#if canEdit}
					<Button type="submit" disabled={busy}>{editing ? 'Save' : 'Add'}</Button>
				{/if}
			</div>
		</div>
	</form>
</dialog>
