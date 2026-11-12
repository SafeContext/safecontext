<script lang="ts">
	// "Where real values go back" (issue #83, editor in #23): the tools whose input gets real
	// values put back in place of placeholders. Local file tools are on by default; any other tool
	// IT adds asks the person before each call.
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { send } from './send.ts';

	let {
		tools,
		localTools,
		neverTools,
		canEdit,
		onmessage
	}: {
		tools: string[];
		localTools: string[];
		neverTools: string[];
		canEdit: boolean;
		onmessage: (message: string, ok: boolean) => void;
	} = $props();

	let shown = $derived(tools);
	const added = $derived(shown.filter((t) => !localTools.includes(t)));
	let adding = $state('');
	let busy = $state(false);

	async function save(next: string[], done?: string) {
		const previous = shown;
		shown = next;
		busy = true;
		const result = await send('swapBack', { tool: next });
		busy = false;
		if (!result.ok) {
			shown = previous;
			onmessage(result.message, false);
			return false;
		}
		if (done) onmessage(done, true);
		return true;
	}

	function toggleLocal(tool: string, on: boolean) {
		save(on ? [...shown, tool] : shown.filter((t) => t !== tool));
	}

	async function add(event: SubmitEvent) {
		event.preventDefault();
		const tool = adding.trim();
		if (!tool || shown.includes(tool)) return;
		if (await save([...shown, tool], `Added ${tool}. Each call to it will ask the person first.`)) {
			adding = '';
		}
	}
</script>

<div class="flex flex-col gap-2">
	<h3 class="font-sans text-[13px] font-semibold tracking-normal">
		File tools in the project folder
	</h3>
	<ul class="flex flex-wrap gap-2" data-testid="swap-back-local">
		{#each localTools as tool (tool)}
			<li>
				<label
					class="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 font-mono text-[13px] {shown.includes(
						tool
					)
						? 'border-field'
						: 'border-dashed border-field text-muted line-through'}"
				>
					<input
						type="checkbox"
						class="m-0 size-3.5 accent-ink"
						checked={shown.includes(tool)}
						disabled={!canEdit || busy}
						onchange={(e) => toggleLocal(tool, (e.currentTarget as HTMLInputElement).checked)}
					/>
					{tool}
				</label>
			</li>
		{/each}
	</ul>
</div>

<div class="flex flex-col gap-2">
	<h3 class="font-sans text-[13px] font-semibold tracking-normal">
		Other tools (the person approves each call)
	</h3>
	{#if added.length > 0}
		<ul class="flex flex-wrap gap-2" data-testid="swap-back-added">
			{#each added as tool (tool)}
				<li
					class="inline-flex max-w-full items-center gap-1 rounded-full border border-[#f0dc6a] bg-[#fff7c2] py-1 pr-1 pl-3 font-mono text-[13px]"
				>
					<span class="break-all">{tool}</span>
					{#if canEdit}
						<button
							type="button"
							class="grid size-7 shrink-0 place-items-center rounded-full hover:bg-ink/10"
							aria-label="Remove {tool}"
							disabled={busy}
							onclick={() =>
								save(
									shown.filter((t) => t !== tool),
									`Removed ${tool}.`
								)}
						>
							<Icon name="close" class="size-3.5" />
						</button>
					{/if}
				</li>
			{/each}
		</ul>
	{:else}
		<p class="text-sm text-muted">
			None. MCP tools and shell commands get the placeholder exactly as Claude wrote it.
		</p>
	{/if}

	{#if canEdit}
		<form class="flex flex-wrap gap-2" onsubmit={add}>
			<label class="sr-only" for="swap-back-add">Tool name</label>
			<input
				id="swap-back-add"
				class="min-w-0 flex-[1_1_12rem] rounded-[10px] border border-field bg-white px-3 py-2 font-mono text-[13px] focus:border-ink focus:outline-none"
				placeholder="mcp__jira__*"
				autocomplete="off"
				spellcheck="false"
				bind:value={adding}
			/>
			<Button type="submit" variant="secondary" disabled={busy || !adding.trim()}>Add tool</Button>
		</form>
		<p class="text-xs text-muted">
			These send real values off the person's device, so the person sees them and approves every
			call. End a name with <code>*</code> to include every tool that starts with it.
		</p>
	{/if}
</div>

<p class="text-xs text-muted">
	Never: {neverTools.join(', ')} (their input goes to Anthropic).
</p>
