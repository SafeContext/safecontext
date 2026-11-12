<script lang="ts">
	// The Safe Context logo: the brand mark (three capsules in the brand colours, from
	// brand/safecontext-mark.svg) and the name. A link when `href` is given.
	let { href, size = 'md' }: { href?: string; size?: 'md' | 'lg' } = $props();

	const mark = { md: 'h-3.5', lg: 'h-5' };
	const name = { md: 'text-[19px]', lg: 'text-2xl' };
</script>

{#snippet lockup()}
	<svg viewBox="0 0 70 16" class="{mark[size]} w-auto" role="img" aria-hidden="true">
		<rect x="0" y="0" width="30" height="16" rx="8" class="fill-mint" />
		<rect x="20" y="0" width="30" height="16" rx="8" class="fill-lemon" />
		<rect x="40" y="0" width="30" height="16" rx="8" class="fill-pink" />
	</svg>
	<span class="font-heading {name[size]} font-bold tracking-tight">Safe Context</span>
{/snippet}

{#if href}
	<!-- Callers pass an href already wrapped in resolve(). -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a {href} class="flex items-center gap-2.5 rounded-lg px-2 py-1">{@render lockup()}</a>
{:else}
	<span class="flex items-center gap-3">{@render lockup()}</span>
{/if}
