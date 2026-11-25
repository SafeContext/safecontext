<script lang="ts">
	// "Deploy to Claude Code" (#25): the managed settings that turn Safe Context on for everyone.
	import { resolve } from '$app/paths';
	import AgentProfileCard from '#lib/components/deploy/AgentProfileCard.svelte';
	import Button from '#lib/components/ui/Button.svelte';
	import Card from '#lib/components/ui/Card.svelte';
	import EmptyState from '#lib/components/ui/EmptyState.svelte';
	import PageHeader from '#lib/components/ui/PageHeader.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let refresh = $state(true);
	let copied = $state(false);
	const text = $derived(refresh ? data.settingsWithRefresh : data.settings);

	async function copy() {
		if (!text) return;
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}
</script>

<svelte:head>
	<title>Deploy · Safe Context</title>
</svelte:head>

<PageHeader eyebrow="Roll out" title="Deploy to Claude Code" />
<p class="-mt-2 max-w-2xl text-muted">
	Managed settings turn Safe Context on in everyone's Claude Code. People can't switch them off.
</p>

{#if !data.published}
	<Card>
		<EmptyState
			title="Publish a policy first"
			description="These settings follow your published policy, so publish one on the Policy page."
		>
			{#snippet action()}
				<Button variant="secondary" href={resolve('/policy')}>Go to Policy</Button>
			{/snippet}
		</EmptyState>
	</Card>
{:else}
	<Card
		title="1. Install the agent on each device"
		description="The agent does the checking, on each person's device. Nothing they type or read is sent to us."
	>
		<p class="text-sm">
			Push <code>SafeContext.pkg</code> to every Mac with your device management tool, or install it
			with Homebrew for developers (<code>brew install safecontext</code>, then
			<code>brew services start safecontext</code>). It starts for each person at login. With the
			profile below, each device joins your organisation and picks up your policy within 30 seconds.
			<code>safecontext doctor</code> on a Mac checks that everything is in place.
		</p>
	</Card>

	<Card
		title="2. Add these managed settings"
		description="They send every prompt and tool call to the agent on the same device."
	>
		{#snippet actions()}
			<Button variant="secondary" onclick={copy} data-testid="copy-settings">
				{copied ? 'Copied' : 'Copy'}
			</Button>
		{/snippet}
		<label class="flex items-center gap-2 text-sm">
			<input type="checkbox" class="accent-ink" bind:checked={refresh} />
			Fetch these settings again every time Claude Code starts
		</label>
		<pre
			class="max-h-96 overflow-auto rounded-xl bg-well p-4 font-mono text-xs leading-relaxed"
			data-testid="managed-settings">{text}</pre>
		<p class="text-xs text-muted">
			{#if data.published.failMode === 'block'}
				If a device's agent isn't running, Claude Code there stops prompts and tool calls, as your
				policy (v{data.published.version}) says.
			{:else}
				If a device's agent isn't running, Claude Code there carries on unchecked, as your policy (v{data
					.published.version}) says.
			{/if}
			Change this under "If a check can't finish" on the
			<a class="underline" href={resolve('/policy')}>Policy page</a>, publish, then copy these
			settings again.
		</p>
	</Card>

	<div class="grid gap-4 lg:grid-cols-2">
		<Card title="With the claude.ai admin console">
			<ol class="list-decimal space-y-1 pl-5 text-sm">
				<li>
					In claude.ai, open Organization settings, then Claude Code, then Managed settings (an
					Owner on a Team or Enterprise plan).
				</li>
				<li>Paste the settings above and save.</li>
				<li>People get them the next time Claude Code starts.</li>
			</ol>
		</Card>
		<Card title="With device management (MDM)">
			<ol class="list-decimal space-y-1 pl-5 text-sm">
				<li>Save the settings above as <code>managed-settings.json</code>.</li>
				<li>
					Deploy it to <code class="break-all">/Library/Application Support/ClaudeCode/</code> on
					Macs, <code class="break-all">C:\Program Files\ClaudeCode\</code> on Windows, or
					<code>/etc/claude-code/</code> on Linux.
				</li>
				<li>Claude Code reads it at start.</li>
			</ol>
		</Card>
	</div>

	<AgentProfileCard organizationName={data.organizationName} dashboardUrl={data.dashboardUrl} />

	<Card>
		<p class="text-sm" data-testid="plugin-warning">
			<strong>Don't also turn on the Safe Context plugin</strong> for people who get these settings: every
			check would run twice. The plugin is for trying Safe Context out without managed settings.
		</p>
		<p class="mt-2 text-sm">
			If your managed settings already limit which addresses HTTP hooks may call (<code
				>allowedHttpHookUrls</code
			>), add <code>http://127.0.0.1:4747/*</code> to that list.
		</p>
	</Card>
{/if}
