<script lang="ts">
	// The app's side menu (issue #96): pages, then the organisation and signed-in admin at the
	// bottom. A drawer on phones, opened from the Header's menu button.
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Icon from '#lib/components/ui/Icon.svelte';
	import Logo from '#lib/components/ui/Logo.svelte';
	import { navItems } from './nav.ts';

	type Admin = {
		email: string;
		name: string | null;
		role: 'admin' | 'viewer';
		organizationName: string;
	};

	let { admin, open = $bindable(false) }: { admin: Admin; open?: boolean } = $props();

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
	class="fixed inset-y-0 left-0 z-30 flex w-64 flex-col gap-7 border-r border-line bg-white px-4 py-6
		transition-transform md:sticky md:top-0 md:h-dvh md:translate-x-0
		{open ? 'translate-x-0' : '-translate-x-full'}"
>
	<Logo href={resolve('/')} />

	<nav aria-label="Main">
		<ul class="flex flex-col gap-0.5">
			{#each navItems as item (item.href)}
				<li>
					<a
						href={resolve(item.href)}
						aria-current={isActive(item.href) ? 'page' : undefined}
						class="flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] font-medium text-subtle
							transition-colors hover:bg-ink/5 aria-[current=page]:bg-ink
							aria-[current=page]:font-semibold aria-[current=page]:text-white"
					>
						<Icon name={item.icon} />
						{item.label}
					</a>
				</li>
			{/each}
		</ul>
	</nav>

	<div class="mt-auto flex flex-col gap-2 rounded-xl border border-line p-3">
		<div class="flex min-w-0 items-center gap-2.5">
			<span
				class="grid size-8 shrink-0 place-items-center rounded-full bg-mint text-sm font-bold"
				aria-hidden="true"
			>
				{admin.organizationName[0]}
			</span>
			<span class="flex min-w-0 flex-col">
				<span class="truncate text-sm font-semibold" data-testid="org-name"
					>{admin.organizationName}</span
				>
				<span class="truncate text-xs text-muted" title={admin.name ?? admin.email}
					>{admin.email}</span
				>
			</span>
		</div>
		<div class="flex items-center justify-between gap-2">
			{#if admin.role === 'viewer'}
				<span
					class="rounded-full bg-ink/8 px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
					title="You can see everything but not change the policy"
					data-testid="view-only">View only</span
				>
			{:else}
				<span class="text-xs text-muted">Admin</span>
			{/if}
			<!-- A plain form post so signing out works without JavaScript and reloads the page. -->
			<form method="POST" action="/sign-out">
				<button
					type="submit"
					class="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium text-subtle hover:bg-ink/5"
				>
					<Icon name="logout" class="size-4" />
					Sign out
				</button>
			</form>
		</div>
	</div>
</aside>
