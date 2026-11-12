<script lang="ts">
	// The policy editor (issue #23). Edits save to a draft straight away; Publish sends them to
	// every device. Viewers see the same page without the controls.
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import DataTypeBoard from '#lib/components/policy/DataTypeBoard.svelte';
	import DataTypeDialog, { type Target } from '#lib/components/policy/DataTypeDialog.svelte';
	import FailModeSection from '#lib/components/policy/FailModeSection.svelte';
	import SwapBackEditor from '#lib/components/policy/SwapBackEditor.svelte';
	import { send } from '#lib/components/policy/send.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let target = $state<Target | null>(null);
	let notice = $state<{ text: string; ok: boolean } | null>(null);
	let busy = $state(false);

	const status = $derived(data.status);

	function say(text: string, ok: boolean) {
		notice = { text, ok };
	}

	const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

	async function publish() {
		busy = true;
		const result = await send('publish', {});
		busy = false;
		if (result.ok) {
			say(
				`Version ${String(result.data?.['published'])} published. Every device picks it up within a minute.`,
				true
			);
		} else say(result.message, false);
	}

	async function discard() {
		if (!confirm('Discard every change since the last publish? This can’t be undone.')) return;
		busy = true;
		const result = await send('discard', {});
		busy = false;
		say(result.ok ? 'Changes discarded.' : result.message, result.ok);
	}
</script>

<svelte:head>
	<title>Policy · Safe Context</title>
</svelte:head>

<PageHeader eyebrow="What Claude Code may see" title="Policy" />

<!-- The publish bar sticks below the phone top bar, and near the top on wider screens. -->
<div
	class="sticky top-[4.25rem] z-[5] flex flex-col gap-3 rounded-[14px] bg-ink px-4 py-3.5 text-white shadow-[0_8px_24px_rgba(16,19,43,0.18)] sm:px-5 md:top-4"
	data-testid="publish-bar"
>
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<span class="flex items-center gap-2 text-sm font-semibold">
			<span class="size-2 rounded-full {status.changed ? 'bg-lemon' : 'bg-mint'}" aria-hidden="true"
			></span>
			{status.changed ? 'Unpublished changes' : 'Up to date'}
		</span>
		<span class="text-sm text-[#c3c6dc]">
			{#if status.published}
				Live: version {status.published.version}, published
				{dateFormat.format(status.published.publishedAt)}{status.published.publishedBy
					? ` by ${status.published.publishedBy}`
					: ''}
			{:else}
				Not published yet
			{/if}
		</span>
		{#if data.canEdit}
			<span class="ml-auto flex gap-2">
				{#if status.published}
					<button
						type="button"
						class="min-h-10 rounded-[10px] border border-[#3a3f66] px-4 text-sm font-semibold hover:bg-white/10 disabled:opacity-40"
						disabled={busy || !status.changed}
						onclick={discard}
					>
						Discard
					</button>
				{/if}
				<button
					type="button"
					class="min-h-10 rounded-[10px] bg-white px-4 text-sm font-bold text-ink hover:bg-white/90 disabled:opacity-40"
					disabled={busy || !status.changed}
					onclick={publish}
				>
					Publish
				</button>
			</span>
		{:else}
			<span
				class="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs font-semibold"
				data-testid="view-only-note">View only: only admins can change the policy</span
			>
		{/if}
	</div>
	<!-- In the sticky bar, so a message is in view wherever the change was made. -->
	<div aria-live="polite" class="empty:hidden">
		{#if notice}
			<p
				class="flex items-start justify-between gap-3 rounded-[10px] px-3.5 py-2 text-sm text-ink {notice.ok
					? 'bg-mint'
					: 'bg-pink'}"
				data-testid="notice"
			>
				{notice.text}
				<button
					type="button"
					class="shrink-0 font-semibold underline"
					onclick={() => (notice = null)}>Dismiss</button
				>
			</p>
		{/if}
	</div>
</div>

<Card
	title="What's sensitive"
	description={data.canEdit
		? 'Anything not listed goes to Claude as it is. Drag a row to the other column, or open it to edit.'
		: 'Anything not listed goes to Claude as it is.'}
>
	{#snippet actions()}
		{#if data.canEdit}
			<Button variant="secondary" onclick={() => (target = { mode: 'add', tier: 'yellow' })}>
				<Icon name="plus" class="size-4" />
				Add data type
			</Button>
		{/if}
	{/snippet}
	<DataTypeBoard
		dataTypes={data.draft.dataTypes}
		canEdit={data.canEdit}
		onopen={(t) => (target = t)}
		onmessage={say}
	/>
</Card>

<div class="grid gap-4 lg:grid-cols-2">
	<Card
		title="Where real values go back"
		description="Claude only sees placeholders. These tools get the real value back just before they run, on the person's device."
	>
		<SwapBackEditor
			tools={data.draft.swapBackTools}
			localTools={data.localTools}
			neverTools={data.neverTools}
			canEdit={data.canEdit}
			onmessage={say}
		/>
	</Card>

	<Card title="If a check can't finish">
		<FailModeSection value={data.draft.failMode} canEdit={data.canEdit} onmessage={say} />
	</Card>
</div>

{#if target}
	<DataTypeDialog
		{target}
		canEdit={data.canEdit}
		onclose={() => (target = null)}
		ondone={(message) => {
			target = null;
			say(message, true);
		}}
	/>
{/if}
