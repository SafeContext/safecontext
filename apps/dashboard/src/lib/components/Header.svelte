<script lang="ts">
	// The phone-width top bar: the logo and the button that opens the side menu. On wider screens
	// the sidebar is always visible, so this bar is hidden.
	import { resolve } from '$app/paths';
	import Icon from './Icon.svelte';
	import Logo from './Logo.svelte';

	let { navOpen, onmenu }: { navOpen: boolean; onmenu: () => void } = $props();
</script>

<header
	class="sticky top-0 z-10 flex items-center gap-2 border-b border-line bg-white/90 px-3 py-2 backdrop-blur md:hidden"
>
	<button
		type="button"
		class="grid size-11 place-items-center rounded-xl hover:bg-ink/5"
		aria-label="Menu"
		aria-controls="sidebar"
		aria-expanded={navOpen}
		onclick={onmenu}
	>
		<Icon name="menu" class="size-6" />
	</button>
	<Logo href={resolve('/')} />
</header>
