/**
 * The MDM configuration profile that sets up the agent on each Mac (#26): the dashboard address,
 * the enrollment key and, optionally, a device name and the company's model server. IT downloads
 * it from the dashboard's Deploy page and pushes it with Jamf, Kandji or similar. The agent reads
 * it as managed preferences in the domain `com.safecontext.agent` (apps/agent/src/install).
 *
 * The keys below are the contract between this profile and the agent: change both together.
 */
export const AGENT_PREFERENCE_DOMAIN = 'com.safecontext.agent';

/** Profile key → the agent setting it stands for. */
export const AGENT_PROFILE_KEYS = {
	DashboardURL: 'SC_DASHBOARD_URL',
	EnrollmentKey: 'SC_ENROLLMENT_KEY',
	DeviceLabel: 'SC_DEVICE_LABEL',
	ModelServerURL: 'SC_TIER2_BASE_URL',
	ModelServerKey: 'SC_TIER2_API_KEY',
	ModelServerModel: 'SC_TIER2_MODEL',
	/** Boolean: use this Mac's model when the server can't be reached (default true). */
	LocalModelFallback: 'SC_TIER2_FALLBACK',
	LocalModel: 'SC_TIER2_FALLBACK_MODEL',
	/** Integer, ms. */
	CheckBudgetMs: 'SC_CHECK_BUDGET_MS'
} as const;

export type AgentProfileKey = keyof typeof AGENT_PROFILE_KEYS;

export interface AgentProfileOptions {
	organizationName: string;
	dashboardUrl: string;
	enrollmentKey?: string;
	/** Text, or the MDM tool's variable for it, e.g. `$SERIALNUMBER` in Jamf. */
	deviceLabel?: string;
	modelServerUrl?: string;
	modelServerKey?: string;
	modelServerModel?: string;
	/** Two random UUIDs (profile, payload). Pass fixed ones in tests. */
	uuids?: [string, string];
}

const escapeXml = (text: string) =>
	text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const entry = (key: string, value: string) => `\t\t\t<key>${key}</key>\n\t\t\t<string>${escapeXml(value)}</string>`;

/** The `.mobileconfig` XML. Empty optional settings are left out. */
export function agentProfile(options: AgentProfileOptions): string {
	const [profileUuid, payloadUuid] = options.uuids ?? [crypto.randomUUID(), crypto.randomUUID()];
	const settings: Array<[AgentProfileKey, string | undefined]> = [
		['DashboardURL', options.dashboardUrl],
		['EnrollmentKey', options.enrollmentKey],
		['DeviceLabel', options.deviceLabel],
		['ModelServerURL', options.modelServerUrl],
		['ModelServerKey', options.modelServerKey],
		['ModelServerModel', options.modelServerModel]
	];
	const keys = settings.flatMap(([k, v]) => (v?.trim() ? [entry(k, v.trim())] : []));
	const org = escapeXml(options.organizationName);
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>PayloadContent</key>
	<array>
		<dict>
			<key>PayloadType</key>
			<string>${AGENT_PREFERENCE_DOMAIN}</string>
			<key>PayloadIdentifier</key>
			<string>${AGENT_PREFERENCE_DOMAIN}.settings.${payloadUuid}</string>
			<key>PayloadUUID</key>
			<string>${payloadUuid}</string>
			<key>PayloadVersion</key>
			<integer>1</integer>
			<key>PayloadDisplayName</key>
			<string>Safe Context agent settings</string>
${keys.join('\n')}
		</dict>
	</array>
	<key>PayloadDisplayName</key>
	<string>Safe Context</string>
	<key>PayloadDescription</key>
	<string>Connects the Safe Context agent on this Mac to ${org}'s dashboard.</string>
	<key>PayloadOrganization</key>
	<string>${org}</string>
	<key>PayloadIdentifier</key>
	<string>${AGENT_PREFERENCE_DOMAIN}.profile</string>
	<key>PayloadUUID</key>
	<string>${profileUuid}</string>
	<key>PayloadType</key>
	<string>Configuration</string>
	<key>PayloadScope</key>
	<string>System</string>
	<key>PayloadVersion</key>
	<integer>1</integer>
</dict>
</plist>
`;
}
