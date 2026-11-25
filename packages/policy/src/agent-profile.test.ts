import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { agentProfile } from './agent-profile.ts';

const uuids: [string, string] = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];

describe('agentProfile (#26)', () => {
	const xml = agentProfile({
		organizationName: 'Macrohard & Co <Demo>',
		dashboardUrl: 'https://dash.example.com',
		enrollmentKey: 'sce_abc',
		deviceLabel: '$SERIALNUMBER',
		modelServerUrl: '  ',
		uuids
	});

	it('holds the settings as keys of the com.safecontext.agent payload, escaped, and skips empty ones', () => {
		expect(xml).toContain('<string>com.safecontext.agent</string>');
		expect(xml).toContain('<key>DashboardURL</key>\n\t\t\t<string>https://dash.example.com</string>');
		expect(xml).toContain('<key>EnrollmentKey</key>\n\t\t\t<string>sce_abc</string>');
		expect(xml).toContain('<key>DeviceLabel</key>\n\t\t\t<string>$SERIALNUMBER</string>');
		expect(xml).not.toContain('ModelServerURL');
		expect(xml).toContain('Macrohard &amp; Co &lt;Demo&gt;');
	});

	it.runIf(process.platform === 'darwin')('is a valid plist the agent can read back', () => {
		const path = join(mkdtempSync(join(tmpdir(), 'sc-profile-')), 'p.mobileconfig');
		writeFileSync(path, xml);
		const json = JSON.parse(execFileSync('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path], { encoding: 'utf8' }));
		expect(json.PayloadType).toBe('Configuration');
		expect(json.PayloadContent[0]).toMatchObject({ DashboardURL: 'https://dash.example.com', EnrollmentKey: 'sce_abc' });
	});
});
