<script lang="ts">
	// "If Safe Context can't finish a check": the policy's fail mode (SPEC.md §2a). It applies when
	// the agent runs out of its time budget, a tier errors, or a request or reply is invalid. An
	// agent that isn't running is a different case: the plugin always blocks then.
	import { DEFAULT_CHECK_BUDGET_MS, type FailMode } from '@safecontext/policy';
	import { send } from './send.ts';

	let {
		value,
		canEdit,
		onmessage
	}: {
		value: FailMode;
		canEdit: boolean;
		onmessage: (message: string, ok: boolean) => void;
	} = $props();

	let shown = $derived(value);
	const seconds = DEFAULT_CHECK_BUDGET_MS / 1000;

	const options: { value: FailMode; title: string; effect: string; recommended?: boolean }[] = [
		{
			value: 'block',
			title: 'Block it',
			effect: 'Claude doesn’t see it. The person is asked to try again.',
			recommended: true
		},
		{
			value: 'allow',
			title: 'Let it through',
			effect: 'Claude sees it unchecked, sensitive data included.'
		}
	];

	async function choose(next: FailMode) {
		const previous = shown;
		shown = next;
		const result = await send('failMode', { failMode: next });
		if (!result.ok) {
			shown = previous;
			onmessage(result.message, false);
		}
	}
</script>

<div class="flex flex-col gap-3.5 text-sm">
	<div class="text-muted" data-testid="fail-mode-causes">
		<p>
			Safe Context checks everything before Claude sees it, usually in well under a second. Rarely,
			a check can't finish because:
		</p>
		<ul class="mt-1 list-disc pl-5">
			<li>it takes longer than {seconds} seconds (for example, on a very busy computer), or</li>
			<li>one of Safe Context's models hits an error.</li>
		</ul>
		<p class="mt-1">Choose what happens then.</p>
	</div>

	<fieldset class="flex flex-col gap-2.5">
		<legend class="sr-only">If Safe Context can't finish a check</legend>
		{#each options as option (option.value)}
			<label
				class="flex cursor-pointer items-start gap-3 rounded-xl border border-line p-3.5 outline-ink has-checked:bg-well has-checked:outline-2 has-disabled:cursor-default"
			>
				<input
					type="radio"
					name="failMode"
					class="mt-1 accent-ink"
					value={option.value}
					checked={shown === option.value}
					disabled={!canEdit}
					onchange={() => choose(option.value)}
				/>
				<span class="flex flex-col gap-1">
					<span class="flex flex-wrap items-center gap-2 text-[15px] font-bold">
						{option.title}
						{#if option.recommended}
							<span
								class="rounded-full bg-clean-soft px-2 py-0.5 text-xs font-semibold text-clean-text"
								>Recommended</span
							>
						{/if}
					</span>
					<span class="text-muted">{option.effect}</span>
				</span>
			</label>
		{/each}
	</fieldset>

	<p class="text-xs text-muted" data-testid="agent-down-note">
		If Safe Context isn't running on a device, everything there is blocked, whatever you choose.
	</p>
</div>
