<script lang="ts" module>
	// A small capsule in one of the brand colours, echoing the logo's three capsules. Used as a
	// colour key next to labels (decorative: the label says what it is).
	export type KeyTone = 'clean' | 'hidden' | 'blocked' | 'neutral';
</script>

<script lang="ts">
	let { tone, class: className = '' }: { tone: KeyTone; class?: string } = $props();

	const tones: Record<KeyTone, string> = {
		clean: 'bg-clean border-clean-edge',
		hidden: 'bg-hidden border-hidden-edge',
		blocked: 'bg-blocked border-blocked-edge',
		neutral: 'bg-ink border-ink'
	};
</script>

<span
	class="inline-block h-2.5 w-4 shrink-0 rounded-full border {tones[tone]} {className}"
	aria-hidden="true"
></span>
