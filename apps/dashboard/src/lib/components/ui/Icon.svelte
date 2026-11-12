<script lang="ts" module>
	// Stroke icons used across the dashboard (decorative: the text next to them names the thing).
	export type IconName =
		| 'overview'
		| 'policy'
		| 'deploy'
		| 'settings'
		| 'plus'
		| 'close'
		| 'grip'
		| 'lock'
		| 'menu'
		| 'logout';
</script>

<script lang="ts">
	let { name, class: className = 'size-[18px]' }: { name: IconName; class?: string } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	class={className}
	fill={name === 'grip' ? 'currentColor' : 'none'}
	stroke={name === 'grip' ? 'none' : 'currentColor'}
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
>
	{#if name === 'overview'}
		<rect x="3" y="3" width="7" height="9" rx="1.5" /><rect
			x="14"
			y="3"
			width="7"
			height="5"
			rx="1.5"
		/>
		<rect x="14" y="12" width="7" height="9" rx="1.5" /><rect
			x="3"
			y="16"
			width="7"
			height="5"
			rx="1.5"
		/>
	{:else if name === 'policy'}
		<path d="M12 3l8 3v6c0 4.5-3.4 8.2-8 9-4.6-.8-8-4.5-8-9V6z" />
	{:else if name === 'deploy'}
		<path d="M12 3v12M7 10l5 5 5-5M4 21h16" />
	{:else if name === 'settings'}
		<circle cx="12" cy="12" r="3" />
		<path
			d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"
		/>
	{:else if name === 'plus'}
		<path d="M12 5v14M5 12h14" />
	{:else if name === 'close'}
		<path d="M6 6l12 12M18 6L6 18" />
	{:else if name === 'grip'}
		<circle cx="9" cy="6" r="1.6" /><circle cx="15" cy="6" r="1.6" /><circle
			cx="9"
			cy="12"
			r="1.6"
		/>
		<circle cx="15" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" /><circle
			cx="15"
			cy="18"
			r="1.6"
		/>
	{:else if name === 'lock'}
		<rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" />
	{:else if name === 'menu'}
		<path d="M4 7h16M4 12h16M4 17h16" />
	{:else if name === 'logout'}
		<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l-5-5 5-5M5 12h11" />
	{/if}
</svg>
