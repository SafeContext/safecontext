/**
 * Claude Code managed settings that turn Safe Context on for a whole organisation (#25): the same
 * `http` hooks as the plugin (`plugin/hooks/hooks.json`; a test keeps them in step), set by IT in
 * the claude.ai admin console or deployed with MDM as `managed-settings.json`. Users can't turn
 * managed hooks off. Docs: https://code.claude.com/docs/en/server-managed-settings.
 */
import { AGENT_API, AGENT_DEFAULT_PORT, AGENT_HOST } from './api.ts';
import type { FailMode } from './policy.ts';

export interface ManagedSettingsOptions {
	/**
	 * The policy's fail mode. `block`: if the agent can't be reached, prompts and tool calls are
	 * stopped (Claude Code's `onFailure: "block"`); `allow`: they go ahead.
	 */
	failMode: FailMode;
	/** Ask Claude Code to fetch these settings again at every start (`forceRemoteSettingsRefresh`). */
	forceRefresh?: boolean;
	port?: number;
}

type HttpHook = { type: 'http'; url: string; statusMessage?: string; onFailure?: 'block' };
type HookGroup = { matcher?: string; hooks: HttpHook[] };

export interface ManagedSettings {
	/**
	 * `CLAUDE_CODE_DISABLE_FILE_MENTIONS`: an `@file` mention is then read with the Read tool, so
	 * the hooks check it (#38). Claude Code 2.1.299 or later; ignored in project settings.
	 */
	env: { CLAUDE_CODE_DISABLE_FILE_MENTIONS: '1' };
	hooks: Record<'UserPromptSubmit' | 'UserPromptExpansion' | 'PreToolUse' | 'PostToolUse', HookGroup[]>;
	forceRemoteSettingsRefresh?: true;
}

/** The managed settings for an organisation. */
export function managedSettings({ failMode, forceRefresh = false, port = AGENT_DEFAULT_PORT }: ManagedSettingsOptions): ManagedSettings {
	const url = (path: string) => `http://${AGENT_HOST}:${port}${path}`;
	const gate = failMode === 'block' ? ({ onFailure: 'block' } as const) : {};
	return {
		env: { CLAUDE_CODE_DISABLE_FILE_MENTIONS: '1' },
		hooks: {
			UserPromptSubmit: [
				{
					hooks: [
						{
							type: 'http',
							url: url(AGENT_API.prompt.path),
							statusMessage: 'Safe Context is checking your prompt…',
							...gate
						}
					]
				}
			],
			UserPromptExpansion: [
				{
					hooks: [
						{
							type: 'http',
							url: url(AGENT_API.promptExpansion.path),
							statusMessage: 'Safe Context is checking this command…',
							...gate
						}
					]
				}
			],
			PreToolUse: [{ matcher: '*', hooks: [{ type: 'http', url: url(AGENT_API.toolInput.path), ...gate }] }],
			PostToolUse: [
				{
					matcher: '*',
					hooks: [
						{
							type: 'http',
							url: url(AGENT_API.toolOutput.path),
							statusMessage: 'Safe Context is checking what Claude read…'
						}
					]
				}
			]
		},
		...(forceRefresh && { forceRemoteSettingsRefresh: true as const })
	};
}
