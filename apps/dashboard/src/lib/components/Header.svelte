<script lang="ts">
	type Admin = {
		email: string;
		name: string | null;
		role: 'admin' | 'viewer';
		organizationName: string;
	};

	let { admin, navOpen, onmenu }: { admin: Admin; navOpen: boolean; onmenu: () => void } = $props();
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
	<div class="ml-auto flex min-w-0 items-center gap-3">
		<span class="hidden text-sm text-ink/60 sm:inline">Organisation</span>
		<span class="flex min-w-0 items-center gap-2 font-semibold" data-testid="org-name">
			<span
				class="grid size-8 shrink-0 place-items-center rounded-full bg-mint text-sm"
				aria-hidden="true"
			>
				{admin.organizationName[0]}
			</span>
			<span class="truncate">{admin.organizationName}</span>
		</span>
		{#if admin.role === 'viewer'}
			<span
				class="rounded-full bg-ink/8 px-3 py-1 text-xs font-semibold whitespace-nowrap"
				title="You can see everything but not change the policy"
				data-testid="view-only">View only</span
			>
		{/if}
		<!-- A plain form post so signing out works without JavaScript and reloads the page. -->
		<form method="POST" action="/sign-out">
			<button
				type="submit"
				class="rounded-full px-3 py-2 text-sm font-medium whitespace-nowrap hover:bg-ink/5"
				title={`Signed in as ${admin.name ? `${admin.name} (${admin.email})` : admin.email}`}
			>
				Sign out
			</button>
		</form>
	</div>
</header>
