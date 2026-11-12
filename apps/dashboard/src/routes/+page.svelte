<script lang="ts">
	import { onMount } from 'svelte';
	import { refreshAll } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import DailyChart from '#lib/components/DailyChart.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import FeedList from '#lib/components/FeedList.svelte';
	import PageHeader from '#lib/components/PageHeader.svelte';
	import ProtectedList from '#lib/components/ProtectedList.svelte';
	import ResultKey from '#lib/components/ResultKey.svelte';
	import StatCard from '#lib/components/StatCard.svelte';
	import { addToDays, addToStats, mergeFeed, parseFeedMessage, type FeedEvent } from '#lib/feed.ts';
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
	const days = $derived(addToDays(data.days, fresh));
	const rolloutText = $derived(
		data.rollout.devices === 0
			? `Policy v${data.rollout.version} · no devices yet`
			: `Policy v${data.rollout.version} on ${data.rollout.current} of ${data.rollout.devices} ${
					data.rollout.devices === 1 ? 'device' : 'devices'
				}`
	);
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
				const event = parseFeedMessage(message.data);
				if (!event) return;
				live = [...live.filter((e) => e.id !== event.id), event];
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

<PageHeader eyebrow="Last 7 days" title="Overview">
	{#if data.rollout.version !== null}
		<a
			href={resolve('/policy')}
			class="inline-flex items-center gap-2 rounded-full border border-line bg-white px-3.5 py-2 text-sm hover:border-ink/30"
			data-testid="rollout"
		>
			<ResultKey
				tone={data.rollout.devices > 0 && data.rollout.current === data.rollout.devices
					? 'clean'
					: 'hidden'}
			/>
			{rolloutText}
		</a>
	{/if}
</PageHeader>

<div class="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4" data-testid="stats">
	<StatCard label="Checks" value={stats.checked} hint="Prompts, tool calls and files" />
	<StatCard label="Nothing found" value={stats.safe} tone="clean" hint="Went to Claude unchanged" />
	<StatCard
		label="Hidden from Claude"
		value={stats.vague}
		tone="hidden"
		hint="Swapped for placeholders"
	/>
	<StatCard
		label="Blocked"
		value={stats.blocked}
		tone="blocked"
		hint="Stopped before reaching Claude"
	/>
</div>

<div class="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
	<Card title="Checks per day" description="By day in UTC, today on the right.">
		<DailyChart {days} />
	</Card>
	<Card title="What was protected" description="Items found per kind of data.">
		{#snippet actions()}
			<a href={resolve('/policy')} class="text-sm font-semibold underline-offset-4 hover:underline"
				>Edit policy</a
			>
		{/snippet}
		<ProtectedList types={data.types} />
	</Card>
</div>

<Card
	title="Live feed"
	description="Counts only. No prompt, file or tool text ever leaves the device."
>
	{#snippet actions()}
		<p
			class="flex items-center gap-2 text-sm font-semibold {status === 'live'
				? 'text-ink'
				: 'text-muted'}"
			data-testid="feed-status"
			data-status={status}
		>
			<span
				class="size-2.5 rounded-full border {status === 'live'
					? 'border-clean-edge bg-clean'
					: 'border-ink/30 bg-ink/10'}"
				aria-hidden="true"
			></span>
			{statusText[status]}
		</p>
	{/snippet}

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
