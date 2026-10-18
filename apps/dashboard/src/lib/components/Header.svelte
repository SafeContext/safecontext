<script lang="ts">
	// Placeholder until auth exists and the real org name is known.
	const orgName = 'Macrohard';

	let { navOpen, onmenu }: { navOpen: boolean; onmenu: () => void } = $props();
</script>

<header
	class="sticky top-0 z-10 flex items-center gap-3 border-b border-ink/10 bg-canvas/90 px-4 py-3 backdrop-blur sm:px-6"
>
	<button
		type="button"
		class="grid size-10 place-items-center rounded-full hover:bg-ink/5 md:hidden"
		aria-label="Menu"
		aria-controls="sidebar"
		aria-expanded={navOpen}
		onclick={onmenu}
	>
		<svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2">
			<path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round" />
		</svg>
	</button>
	<div class="ml-auto flex items-center gap-3">
		<span class="text-sm text-ink/60">Organisation</span>
		<span class="flex items-center gap-2 font-semibold" data-testid="org-name">
			<span class="grid size-8 place-items-center rounded-full bg-mint text-sm" aria-hidden="true">
				{orgName[0]}
			</span>
			{orgName}
		</span>
	</div>
</header>
