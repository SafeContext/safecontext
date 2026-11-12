<script lang="ts">
	import { prefersReducedMotion } from 'svelte/motion';
	import { fly } from 'svelte/transition';
	import {
		RESULT_LABELS,
		stageLabel,
		timeAgo,
		toolLabel,
		type EventResult,
		type FeedEvent
	} from '#lib/feed.ts';
	import Pill from './Pill.svelte';

	/** `now` (ms) drives the "4 min ago" labels; the parent ticks it. */
	let { events, now }: { events: FeedEvent[]; now: number } = $props();

	const tones: Record<EventResult, 'safe' | 'vague' | 'never'> = {
		safe: 'safe',
		vague: 'vague',
		blocked: 'never'
	};

	// UTC so the server-rendered and browser-rendered text match (the server can't know the
	// viewer's time zone).
	const fullTime = (iso: string) =>
		new Date(iso).toLocaleString('en-GB', {
			dateStyle: 'medium',
			timeStyle: 'medium',
			timeZone: 'UTC'
		}) + ' UTC';
</script>

<div
	class="hidden grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_7rem_8rem] gap-4 border-b border-line pb-2.5 text-xs font-semibold tracking-[0.05em] text-muted uppercase sm:grid"
	aria-hidden="true"
>
	<span>Check</span>
	<span>Device</span>
	<span>When</span>
	<span class="text-right">Result</span>
</div>

<ol class="divide-y divide-[#f0f1f5]" aria-label="Latest checks">
	{#each events as event (event.id)}
		<li
			class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_7rem_8rem]"
			data-testid="feed-row"
			data-event-id={event.id}
			in:fly={{ y: prefersReducedMotion.current ? 0 : -8, duration: 250 }}
		>
			<div class="min-w-0">
				<p class="truncate font-mono text-sm font-medium">{toolLabel(event)}</p>
				<p class="text-xs text-muted">{stageLabel(event.hookEvent)}</p>
			</div>
			<div class="col-start-2 row-start-1 justify-self-end sm:col-start-4">
				<Pill tone={tones[event.result]}>{RESULT_LABELS[event.result]}</Pill>
			</div>
			<p class="min-w-0 truncate text-[13px] text-subtle sm:col-start-2 sm:row-start-1">
				<span class="sr-only">Device </span>
				<span class="font-mono" data-testid="feed-device">{event.deviceId}</span>
			</p>
			<p class="text-right text-sm text-muted sm:col-start-3 sm:row-start-1 sm:text-left">
				<time datetime={event.ts} title={fullTime(event.ts)}>{timeAgo(event.ts, now)}</time>
			</p>
		</li>
	{/each}
</ol>
