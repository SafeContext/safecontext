<script lang="ts">
	import type { Snippet } from 'svelte';

	/** `vague` = lemon, `safe` = mint, `never` = pink ("never share"). */
	type Tone = 'neutral' | 'vague' | 'safe' | 'never';

	let { tone = 'neutral', children }: { tone?: Tone; children: Snippet } = $props();

	const tones: Record<Tone, string> = {
		neutral: 'bg-ink/8 text-ink',
		vague: 'bg-lemon text-ink',
		safe: 'bg-mint text-ink',
		never: 'bg-pink text-ink'
	};
</script>

<span
	class="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold whitespace-nowrap {tones[
		tone
	]}"
>
	{@render children()}
</span>
