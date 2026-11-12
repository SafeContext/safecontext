<script lang="ts">
	// The policy editor (issue #23). Edits save to a draft straight away; Publish sends them to
	// every Mac. Viewers see the same page without the controls.
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import Pill from '#lib/components/Pill.svelte';
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

	const dateFormat = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

	async function publish() {
		busy = true;
		const result = await send('publish', {});
		busy = false;
		if (result.ok) {
			say(
				`Version ${String(result.data?.['published'])} published. Every Mac picks it up within a minute.`,
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

<div class="mb-2 flex flex-wrap items-center gap-3">
	<h1 class="text-3xl font-bold">Policy</h1>
</div>
<p class="mb-6 max-w-2xl text-ink/70">
	Decide what Claude Code is allowed to see. Changes are saved as a draft; nothing changes on
	anyone's Mac until you publish.
</p>

<div
	class="sticky top-16 z-[5] mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-ink/10 bg-white/95 px-5 py-3 shadow-sm backdrop-blur"
	data-testid="publish-bar"
>
	<div class="min-w-0 flex-1 text-sm">
		{#if status.published}
			<span class="font-semibold">Version {status.published.version}</span>
			<span class="text-ink/70">
				published {dateFormat.format(status.published.publishedAt)}{status.published.publishedBy
					? ` by ${status.published.publishedBy}`
					: ''}
			</span>
		{:else}
			<span class="font-semibold">Not published yet</span>
		{/if}
	</div>
	{#if status.changed}
		<Pill tone="vague">Unpublished changes</Pill>
	{:else}
		<Pill tone="safe">Up to date</Pill>
	{/if}
	{#if data.canEdit}
		<div class="flex gap-2">
			{#if status.published}
				<Button variant="ghost" disabled={busy || !status.changed} onclick={discard}>
					Discard changes
				</Button>
			{/if}
			<Button disabled={busy || !status.changed} onclick={publish}>Publish</Button>
		</div>
	{/if}
	<!-- In the sticky bar, so a message is in view wherever the change was made. -->
	<div aria-live="polite" class="basis-full empty:hidden">
		{#if notice}
			<p
				class="flex items-start justify-between gap-3 rounded-xl px-4 py-2 text-sm {notice.ok
					? 'bg-mint/60'
					: 'bg-pink/60'}"
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

{#if !data.canEdit}
	<p class="mb-6 rounded-xl bg-ink/5 px-4 py-3 text-sm" data-testid="view-only-note">
		You can see the policy, but only admins can change it.
	</p>
{/if}

<div class="flex flex-col gap-6">
	<Card title="What's sensitive">
		<p class="mb-4 max-w-2xl text-sm text-ink/70">
			Each pill is a kind of data Safe Context protects. Anything not here goes to Claude as it is.
			{#if data.canEdit}
				Drag a pill to the other column, open it to change how it's hidden and the words to catch,
				or delete it to stop protecting it.
			{/if}
		</p>
		<DataTypeBoard
			dataTypes={data.draft.dataTypes}
			canEdit={data.canEdit}
			onopen={(t) => (target = t)}
			onmessage={say}
		/>
	</Card>

	<Card title="Where real values go back">
		<SwapBackEditor
			tools={data.draft.swapBackTools}
			localTools={data.localTools}
			neverTools={data.neverTools}
			canEdit={data.canEdit}
			onmessage={say}
		/>
	</Card>

	<Card title="If Safe Context can't finish a check">
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
