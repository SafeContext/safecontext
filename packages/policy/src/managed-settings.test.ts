import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { managedSettings } from './managed-settings.ts';

const plugin = JSON.parse(readFileSync(join(import.meta.dirname, '../../../plugin/hooks/hooks.json'), 'utf8')) as {
	hooks: Record<string, unknown>;
};

describe('managed settings (#25)', () => {
	it('has exactly the plugin\'s http hooks when the fail mode is block', () => {
		const { SessionStart: _status, ...pluginHttp } = plugin.hooks;
		expect(managedSettings({ failMode: 'block' }).hooks).toEqual(pluginHttp);
	});

	it('lets calls through when the agent is unreachable, if the fail mode is allow', () => {
		const json = JSON.stringify(managedSettings({ failMode: 'allow' }));
		expect(json).not.toContain('onFailure');
		expect(json).toContain('/v1/tool-input');
	});

	it('asks for a refresh at start only when told to', () => {
		expect(managedSettings({ failMode: 'block' })).not.toHaveProperty('forceRemoteSettingsRefresh');
		expect(managedSettings({ failMode: 'block', forceRefresh: true }).forceRemoteSettingsRefresh).toBe(true);
	});
});
