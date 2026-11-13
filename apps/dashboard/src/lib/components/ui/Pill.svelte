<script lang="ts">
	import type { Snippet } from 'svelte';
	import { TONE_CLASSES, type Tone } from '#lib/tones.ts';

	let { tone = 'neutral', children }: { tone?: Tone; children: Snippet } = $props();
</script>

<span
	class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap {TONE_CLASSES[
		tone
	].chip}"
>
	{@render children()}
</span>
