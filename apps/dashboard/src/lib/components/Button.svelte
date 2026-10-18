<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	type Variant = 'primary' | 'secondary' | 'ghost';

	type Props = {
		variant?: Variant;
		children: Snippet;
		/** When set, renders a link (`<a>`) styled as a button. */
		href?: string;
	} & Omit<HTMLButtonAttributes, 'children'> &
		Omit<HTMLAnchorAttributes, 'children' | 'type'>;

	let {
		variant = 'primary',
		href,
		children,
		class: className = '',
		type = 'button',
		...rest
	}: Props = $props();

	const base =
		'inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold ' +
		'transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ' +
		'disabled:cursor-not-allowed disabled:opacity-50';

	const variants: Record<Variant, string> = {
		primary: 'bg-ink text-white hover:bg-ink/85',
		secondary: 'border border-ink/20 bg-white text-ink hover:border-ink/40 hover:bg-ink/5',
		ghost: 'text-ink hover:bg-ink/8'
	};

	const classes = $derived(`${base} ${variants[variant]} ${className}`);
</script>

{#if href}
	<!-- Callers pass an href already wrapped in resolve(). -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a {href} class={classes} {...rest as HTMLAnchorAttributes}>{@render children()}</a>
{:else}
	<button {type} class={classes} {...rest as HTMLButtonAttributes}>{@render children()}</button>
{/if}
