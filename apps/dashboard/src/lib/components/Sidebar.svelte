<script lang="ts">
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { navItems } from './nav.ts';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	// Close the mobile drawer after navigating.
	$effect(() => {
		void page.url.pathname;
		open = false;
	});

	const isActive = (href: string) =>
		href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);
</script>

{#if open}
	<button
		type="button"
		class="fixed inset-0 z-20 bg-ink/40 md:hidden"
		aria-label="Close menu"
		onclick={() => (open = false)}
	></button>
{/if}

<aside
	id="sidebar"
	class="fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-8 border-r border-ink/10 bg-white p-5
		transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0
		{open ? 'translate-x-0' : '-translate-x-full'}"
>
	<a href={resolve('/')} class="font-heading text-2xl font-bold tracking-tight">Safe Context</a>
	<nav aria-label="Main">
		<ul class="flex flex-col gap-1">
			{#each navItems as item (item.href)}
				<li>
					<a
						href={resolve(item.href)}
						aria-current={isActive(item.href) ? 'page' : undefined}
						class="block rounded-xl px-4 py-2.5 font-medium transition-colors hover:bg-ink/5
							aria-[current=page]:bg-lemon"
					>
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>
</aside>
