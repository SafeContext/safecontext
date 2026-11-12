<script lang="ts">
	// "Where real values go back" (issue #83, editor in #23): the tools whose input gets real
	// values put back in place of placeholders. Local file tools are on by default; any other tool
	// IT adds asks the person before each call.
	import Button from '#lib/components/Button.svelte';
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

<p class="mb-4 max-w-2xl text-sm text-ink/70">
	Claude only sees placeholders such as <code>⟪customer_name_1⟫</code>. When Claude uses one of
	these tools, Safe Context puts the real value back just before the tool runs, on the person's Mac.
	Claude never sees it.
</p>

<h3 class="mb-2 text-sm font-semibold">File tools in the project folder</h3>
<ul class="mb-5 flex flex-wrap gap-2" data-testid="swap-back-local">
	{#each localTools as tool (tool)}
		<li>
			<label
				class="inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold {shown.includes(
					tool
				)
					? 'bg-mint'
					: 'bg-ink/8 text-ink/60 line-through'}"
			>
				<input
					type="checkbox"
					class="size-3.5"
					checked={shown.includes(tool)}
					disabled={!canEdit || busy}
					onchange={(e) => toggleLocal(tool, (e.currentTarget as HTMLInputElement).checked)}
				/>
				{tool}
			</label>
		</li>
	{/each}
</ul>

<h3 class="mb-1 text-sm font-semibold">Other tools, each call approved by the person first</h3>
<p class="mb-2 max-w-2xl text-sm text-ink/70">
	These send real values off the Mac (an MCP server, a shell command), so the person sees the real
	values and approves every call. Use a name ending in <code>*</code> for every tool that starts
	with it, e.g. <code>mcp__slack__*</code>.
</p>
{#if added.length > 0}
	<ul class="mb-3 flex flex-wrap gap-2" data-testid="swap-back-added">
		{#each added as tool (tool)}
			<li
				class="inline-flex max-w-full items-center gap-1 rounded-full bg-lemon py-1 pr-1 pl-3 text-xs font-semibold"
			>
				<code class="break-all">{tool}</code>
				{#if canEdit}
					<button
						type="button"
						class="grid size-6 shrink-0 place-items-center rounded-full hover:bg-ink/10"
						aria-label="Remove {tool}"
						disabled={busy}
						onclick={() =>
							save(
								shown.filter((t) => t !== tool),
								`Removed ${tool}.`
							)}
					>
						<svg
							viewBox="0 0 24 24"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="2.5"
						>
							<path d="M6 6l12 12M18 6L6 18" stroke-linecap="round" />
						</svg>
					</button>
				{/if}
			</li>
		{/each}
	</ul>
{:else}
	<p class="mb-3 text-sm text-ink/70">
		None. MCP tools and shell commands get the placeholder exactly as Claude wrote it.
	</p>
{/if}

{#if canEdit}
	<form class="mb-4 flex max-w-md flex-wrap gap-2" onsubmit={add}>
		<label class="sr-only" for="swap-back-add">Tool name</label>
		<input
			id="swap-back-add"
			class="min-w-0 flex-1 rounded-full border border-ink/20 bg-white px-4 py-2 font-mono text-sm focus:border-ink focus:outline-none"
			placeholder="mcp__slack__*"
			autocomplete="off"
			spellcheck="false"
			bind:value={adding}
		/>
		<Button type="submit" variant="secondary" disabled={busy || !adding.trim()}>Add tool</Button>
	</form>
{/if}

<p class="text-sm text-ink/70">
	Real values never go into {neverTools.join(', ')}: their input goes to Anthropic.
</p>
