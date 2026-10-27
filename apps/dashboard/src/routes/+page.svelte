<script lang="ts">
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FeedList from '#lib/components/FeedList.svelte';
	import StatCard from '#lib/components/StatCard.svelte';
	import { addToStats, FeedEvent, mergeFeed } from '#lib/feed.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	/** Reload the page data after this many live events, so `live` can't grow without limit. */
	const LIVE_MAX = 1000;

	/** Events received live since the page data was loaded. */
	let live = $state<FeedEvent[]>([]);
	let status = $state<'connecting' | 'live' | 'reconnecting'>('connecting');
	/** Browser clock for the "4 min ago" labels; until it starts, use the server's time. */
	let clock = $state<number | null>(null);

	const now = $derived(clock ?? Date.parse(data.asOf));

	/** Live events that the loaded stats don't already include. */
	const fresh = $derived(live.filter((e) => e.receivedAt > data.asOf && e.ts >= data.since));
	const stats = $derived(addToStats(data.stats, fresh));
	const events = $derived(mergeFeed(live, data.events));

	/** Reloads stats and feed from the database, then drops live events it now includes. */
	async function resync() {
		await refreshAll();
		live = live.filter((e) => e.receivedAt > data.asOf);
	}

	onMount(() => {
		let source: EventSource | null = null;
		let retry: ReturnType<typeof setTimeout> | undefined;

		const connect = () => {
			source = new EventSource(resolve('/live-feed'));
			// Every (re)connect reloads the data once, so events sent while disconnected (or between
			// the page loading and the stream opening) aren't missed.
			source.onopen = () => {
				status = 'live';
				void resync();
			};
			source.onmessage = (message) => {
				const parsed = FeedEvent.safeParse(JSON.parse(message.data));
				if (!parsed.success) return;
				live = [...live.filter((e) => e.id !== parsed.data.id), parsed.data];
				if (live.length > LIVE_MAX) void resync();
			};
			source.onerror = () => {
				status = 'reconnecting';
				// The browser retries by itself unless the server refused (e.g. 503); then we do.
				if (source?.readyState === EventSource.CLOSED) {
					source.close();
					retry = setTimeout(connect, 5000);
				}
			};
		};
		connect();

		clock = Date.now();
		const tick = setInterval(() => (clock = Date.now()), 10_000);

		return () => {
			clearTimeout(retry);
			clearInterval(tick);
			source?.close();
		};
	});

	const statusText = { connecting: 'Connecting…', live: 'Live', reconnecting: 'Reconnecting…' };
</script>

<svelte:head>
	<title>Overview · Safe Context</title>
</svelte:head>

<h1 class="mb-2 text-3xl font-bold">Overview</h1>
<p class="mb-6 max-w-2xl text-ink/70">
	What Safe Context checked for your team. Counts only: no prompt, file or tool text ever reaches
	the dashboard.
</p>

<h2 class="mb-3 font-sans text-sm font-semibold tracking-normal text-ink/60">Last 7 days</h2>
<div class="mb-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="stats">
	<StatCard label="Checked" value={stats.checked} hint="Prompts and tool calls" />
	<StatCard label="Safe to share" value={stats.safe} tone="safe" hint="Nothing needed changing" />
	<StatCard label="Made vague" value={stats.vague} tone="vague" hint="Sensitive parts changed" />
	<StatCard label="Blocked" value={stats.blocked} tone="never" hint="Stopped before sending" />
</div>

<Card>
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3">
		<h2 class="text-lg font-semibold">Live feed</h2>
		<p
			class="flex items-center gap-2 text-sm font-medium text-ink/70"
			data-testid="feed-status"
			data-status={status}
		>
			<span
				class="size-2.5 rounded-full {status === 'live'
					? 'bg-mint ring-2 ring-mint/40'
					: 'bg-ink/30'}"
				aria-hidden="true"
			></span>
			{statusText[status]}
		</p>
	</div>

	{#if events.length}
		<FeedList {events} {now} />
	{:else}
		<EmptyState
			title="Nothing checked yet"
			description="Checks appear here as they happen, once Safe Context is deployed to your team."
		>
			{#snippet action()}
				<Button variant="secondary" href={resolve('/deploy')}>Go to Deploy</Button>
			{/snippet}
		</EmptyState>
	{/if}
</Card>
