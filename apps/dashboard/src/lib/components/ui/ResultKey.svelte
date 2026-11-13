<script lang="ts">
	// A small capsule in one of the brand colours, echoing the logo's three capsules. Used as a
	// colour key next to labels (decorative: the label says what it is).
	import { TONE_CLASSES, type Tone } from '#lib/tones.ts';

	let { tone, class: className = '' }: { tone: Tone; class?: string } = $props();
</script>

<span
	class="inline-block h-2.5 w-4 shrink-0 rounded-full border {TONE_CLASSES[tone].key} {className}"
	aria-hidden="true"
></span>
