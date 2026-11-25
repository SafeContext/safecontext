<script lang="ts">
	// The organisation's devices (#51): when each was last seen, which policy it has, and Revoke.
	import Button from '#lib/components/ui/Button.svelte';
	import Pill from '#lib/components/ui/Pill.svelte';
	import { timeAgo } from '#lib/feed.ts';
	import { send } from '#lib/send.ts';

	type Device = {
		id: string;
		deviceId: string;
		label: string | null;
		firstSeenAt: Date;
		lastSeenAt: Date;
		lastPolicyVersion: number | null;
		status: 'active' | 'revoked' | 'no_token';
	};

	let {
		devices,
		publishedVersion,
		canEdit,
		now,
		onmessage
	}: {
		devices: Device[];
		/** The latest published policy version, or null if none. */
		publishedVersion: number | null;
		canEdit: boolean;
		/** Drives the "4 min ago" labels. */
		now: number;
		onmessage: (message: string, ok: boolean) => void;
	} = $props();

	let busy = $state<string | null>(null);

	const STATUS: Record<Device['status'], string> = {
		active: 'Active',
		revoked: 'Revoked',
		no_token: 'Not connected'
	};

	const name = (d: Device) => d.label ?? d.deviceId;

	function policy(d: Device): string {
		if (d.lastPolicyVersion === null) return 'No checks yet';
		if (publishedVersion !== null && d.lastPolicyVersion < publishedVersion) {
			return `v${d.lastPolicyVersion} (behind)`;
		}
		return `v${d.lastPolicyVersion}`;
	}

	async function revoke(d: Device) {
		if (
			!confirm(
				`Revoke ${name(d)}? It stops getting your policy and sending events at once. If it still has the enrollment key it can join again as a new device, so make a new key too if it was lost.`
			)
		) {
			return;
		}
		busy = d.id;
		const result = await send('revoke', { id: d.id });
		busy = null;
		onmessage(result.ok ? `${name(d)} revoked.` : result.message, result.ok);
	}
</script>

<!-- relative: the screen-reader-only header must scroll with the table, not widen the page. -->
<div class="relative -mx-5 overflow-x-auto sm:-mx-6">
	<table class="w-full min-w-[40rem] text-left text-sm" data-testid="device-list">
		<thead class="text-xs text-muted">
			<tr class="border-b border-divider">
				<th scope="col" class="py-2 pr-3 pl-5 font-semibold sm:pl-6">Device</th>
				<th scope="col" class="px-3 py-2 font-semibold">Status</th>
				<th scope="col" class="px-3 py-2 font-semibold">Last seen</th>
				<th scope="col" class="px-3 py-2 font-semibold">Policy</th>
				{#if canEdit}<th scope="col" class="py-2 pr-5 pl-3 sm:pr-6"
						><span class="sr-only">Actions</span></th
					>{/if}
			</tr>
		</thead>
		<tbody>
			{#each devices as d (d.id)}
				<tr class="border-b border-divider last:border-0" data-testid="device-row">
					<td class="py-3 pr-3 pl-5 sm:pl-6">
						<div class="font-semibold break-all">{name(d)}</div>
						{#if d.label}<div class="font-mono text-xs break-all text-muted">{d.deviceId}</div>{/if}
					</td>
					<td class="px-3 py-3"><Pill>{STATUS[d.status]}</Pill></td>
					<td class="px-3 py-3 whitespace-nowrap">{timeAgo(d.lastSeenAt.toISOString(), now)}</td>
					<td class="px-3 py-3 whitespace-nowrap">{policy(d)}</td>
					{#if canEdit}
						<td class="py-3 pr-5 pl-3 text-right sm:pr-6">
							{#if d.status !== 'revoked'}
								<Button
									variant="ghost"
									onclick={() => revoke(d)}
									disabled={busy !== null}
									aria-label="Revoke {name(d)}"
								>
									Revoke
								</Button>
							{/if}
						</td>
					{/if}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
