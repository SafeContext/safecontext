<script lang="ts">
	import './layout.css';
	import favicon from '#lib/assets/favicon.svg';
	import Header from '#lib/components/Header.svelte';
	import Sidebar from '#lib/components/Sidebar.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	let navOpen = $state(false);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if data.admin}
	<div class="min-h-dvh md:grid md:grid-cols-[16rem_1fr]">
		<Sidebar bind:open={navOpen} />
		<div class="flex min-w-0 flex-col">
			<Header admin={data.admin} {navOpen} onmenu={() => (navOpen = !navOpen)} />
			<main class="flex-1 p-4 sm:p-6 lg:p-8">
				{@render children()}
			</main>
		</div>
	</div>
{:else}
	<!-- Signed out: only the sign-in page (and error pages) render here, without the app shell. -->
	<main>
		{@render children()}
	</main>
{/if}
