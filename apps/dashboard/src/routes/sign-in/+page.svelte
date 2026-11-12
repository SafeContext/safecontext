<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.ts';
	import Button from '#lib/components/ui/Button.svelte';
	import Logo from '#lib/components/ui/Logo.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let email = $state('');
	let password = $state('');
	let message = $state('');
	let busy = $state(false);

	async function signIn(event: SubmitEvent) {
		event.preventDefault();
		busy = true;
		message = '';
		const { error } = await authClient.signIn.email({ email, password });
		if (error) {
			busy = false;
			message =
				error.status === 429
					? 'Too many attempts. Wait a few seconds and try again.'
					: error.status === 401 || error.status === 400
						? "That email and password don't match an admin account."
						: "Couldn't sign in. Try again in a moment.";
			return;
		}
		// A path on this site, checked by the server (`safeRedirectTarget`).
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		await goto(data.redirectTo, { invalidateAll: true });
	}
</script>

<svelte:head>
	<title>Sign in · Safe Context</title>
</svelte:head>

<div class="grid min-h-dvh place-items-center p-4">
	<div class="w-full max-w-sm">
		<div class="mb-6 flex justify-center"><Logo size="lg" /></div>
		<section class="rounded-2xl border border-ink/10 bg-white p-6 shadow-sm">
			<h1 class="mb-1 text-2xl font-bold">Sign in</h1>
			<p class="mb-6 text-sm text-ink/70">For your organisation's Safe Context admins.</p>

			<form class="flex flex-col gap-4" onsubmit={signIn}>
				<label class="flex flex-col gap-1.5 text-sm font-medium">
					Email
					<input
						class="rounded-xl border border-ink/20 px-3 py-2 text-base font-normal focus:border-ink focus:outline-none"
						type="email"
						name="email"
						autocomplete="username"
						required
						bind:value={email}
					/>
				</label>
				<label class="flex flex-col gap-1.5 text-sm font-medium">
					Password
					<input
						class="rounded-xl border border-ink/20 px-3 py-2 text-base font-normal focus:border-ink focus:outline-none"
						type="password"
						name="password"
						autocomplete="current-password"
						required
						bind:value={password}
					/>
				</label>
				{#if message}
					<p class="rounded-xl bg-pink/50 px-3 py-2 text-sm" role="alert">{message}</p>
				{/if}
				<Button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</Button>
			</form>
		</section>
		<p class="mt-4 text-center text-sm text-ink/60">
			No account? Ask whoever runs Safe Context at your company to add you.
		</p>
	</div>
</div>
