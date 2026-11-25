<script lang="ts">
	// The MDM configuration profile that sets up the agent on each Mac (#26). Built in the browser:
	// the enrollment key and model server key typed here are never sent to the dashboard.
	import { agentProfile } from '@safecontext/policy';
	import { resolve } from '$app/paths';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';

	let { organizationName, dashboardUrl }: { organizationName: string; dashboardUrl: string } =
		$props();

	let enrollmentKey = $state('');
	let deviceLabel = $state('');
	let modelServerUrl = $state('');
	let modelServerKey = $state('');

	const keyOk = $derived(/^sce_[A-Za-z0-9_-]{43}$/.test(enrollmentKey.trim()));
	const serverOk = $derived(
		!modelServerUrl.trim() ||
			(/^https:\/\/[^\s/]+/.test(modelServerUrl.trim()) && !!modelServerKey.trim())
	);

	function download() {
		const xml = agentProfile({
			organizationName,
			dashboardUrl,
			enrollmentKey: enrollmentKey.trim(),
			deviceLabel,
			modelServerUrl,
			modelServerKey
		});
		const url = URL.createObjectURL(new Blob([xml], { type: 'application/x-apple-aspen-config' }));
		const a = document.createElement('a');
		a.href = url;
		a.download = 'SafeContext.mobileconfig';
		a.click();
		URL.revokeObjectURL(url);
	}

	const field = 'w-full rounded-[10px] border border-field bg-white px-3 py-2 text-sm';
</script>

<Card
	title="3. Connect each device to your dashboard"
	description="A configuration profile for your device management tool. It gives the agent your dashboard address and enrollment key."
>
	<div class="grid gap-4 sm:grid-cols-2">
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-semibold">Enrollment key</span>
			<input
				class="{field} font-mono"
				type="password"
				autocomplete="off"
				spellcheck="false"
				placeholder="sce_…"
				bind:value={enrollmentKey}
				data-testid="profile-key"
			/>
			<span class="text-xs text-muted">
				Make one on the <a class="underline" href={resolve('/settings')}>Settings page</a>. It's
				only put in the file you download.
			</span>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-semibold">Device name (optional)</span>
			<input class={field} placeholder="e.g. $SERIALNUMBER" bind:value={deviceLabel} />
			<span class="text-xs text-muted">
				Shown on the Settings page. Use your tool's variable, such as Jamf's <code
					>$SERIALNUMBER</code
				>.
			</span>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-semibold">Model server address (optional)</span>
			<input
				class={field}
				placeholder="https://models.example.com/v1"
				bind:value={modelServerUrl}
			/>
			<span class="text-xs text-muted">
				Your own model server for context checks. Without one, each Mac uses its own model if it has
				one.
			</span>
		</label>
		<label class="flex flex-col gap-1 text-sm">
			<span class="font-semibold">Model server key</span>
			<input class={field} type="password" autocomplete="off" bind:value={modelServerKey} />
		</label>
	</div>
	<div class="flex flex-wrap items-center gap-3">
		<Button onclick={download} disabled={!keyOk || !serverOk} data-testid="download-profile">
			Download profile
		</Button>
		<span class="text-xs text-muted" aria-live="polite">
			{#if !keyOk}
				Paste an enrollment key to download.
			{:else if !serverOk}
				A model server needs an https address and a key.
			{:else}
				Upload <code>SafeContext.mobileconfig</code> to your tool as a custom profile for every Mac.
			{/if}
		</span>
	</div>
</Card>
