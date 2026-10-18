import { Policy, type DataType } from './policy.ts';

/**
 * Data type ids the tier 0 detectors emit. Detectors must use these, not their own ids.
 * (Admin term lists use whatever data type the admin picks.)
 */
export const BUILTIN_DATA_TYPE = {
	/** API keys, tokens, private keys, passwords. */
	secrets: 'secrets',
	/** Emails, phone numbers, card numbers, IP addresses of customers or people. */
	personalData: 'customer-personal-data'
} as const;

/**
 * PROPOSED defaults, pending team approval in issue #2. Used to seed new organisations and
 * as the agent's fallback when it has no policy yet.
 */
export const DEFAULT_DATA_TYPES: DataType[] = [
	// Green: safe to share
	{
		id: 'public-docs',
		name: 'Public docs',
		description: 'Documentation, marketing pages and other material already published to the public.',
		examples: ['our public API reference', 'the pricing page'],
		tier: 'green',
		action: 'allow'
	},
	{
		id: 'release-notes',
		name: 'Release notes',
		description: 'Features and fixes that have already shipped and been announced.',
		examples: ['v2.4 is now public', 'we released dark mode last month'],
		tier: 'green',
		action: 'allow'
	},
	{
		id: 'open-source-code',
		name: 'Open-source code',
		description: 'Code from public open-source projects and libraries.',
		examples: ['a snippet from React', 'our public SDK on GitHub'],
		tier: 'green',
		action: 'allow'
	},
	// Yellow: make it vague
	{
		id: 'revenue-figures',
		name: 'Revenue figures',
		description: 'Non-public revenue, bookings, margins or growth numbers.',
		examples: ['Q3 revenue was $4.2M', 'gross margin hit 71%'],
		tier: 'yellow',
		action: 'generalize'
	},
	{
		id: 'internal-metrics',
		name: 'Internal metrics',
		description: 'Non-public usage, adoption, churn or performance metrics.',
		examples: ['adoption reached 62%', 'churn rose among SMB customers'],
		tier: 'yellow',
		action: 'generalize'
	},
	{
		id: 'deal-sizes',
		name: 'Deal sizes',
		description: 'Contract values, renewals and pricing agreed with specific customers.',
		examples: ['a $1.1M renewal', 'their contract is worth $300k a year'],
		tier: 'yellow',
		action: 'generalize'
	},
	{
		id: 'customer-names',
		name: 'Customer names',
		description: 'Names of customer companies or organisations.',
		examples: ['Northwind', 'Acme Corp'],
		tier: 'yellow',
		action: 'pseudonymize'
	},
	// Red: never share
	{
		id: 'unreleased-roadmap',
		name: 'Unreleased roadmap',
		description: 'Plans, launch dates and codenames for products or features that are not public yet.',
		examples: ['Project Atlas launches March 3', 'the Q4 roadmap'],
		tier: 'red',
		action: 'block'
	},
	{
		id: BUILTIN_DATA_TYPE.secrets,
		name: 'API keys & secrets',
		description: 'API keys, access tokens, private keys, passwords and connection strings.',
		examples: ['sk-live-8f2a91...', 'a database password'],
		tier: 'red',
		action: 'block'
	},
	{
		id: BUILTIN_DATA_TYPE.personalData,
		name: 'Customer personal data',
		description: 'Personal details of customers or people: emails, phone numbers, card numbers, addresses.',
		examples: ['jane@northwind.com', 'card 4242 4242 4242 4242'],
		tier: 'red',
		action: 'pseudonymize'
	}
];

/** A valid policy built from the defaults. `version` 0 means "never published". */
export function defaultPolicy(now: Date = new Date()): Policy {
	return Policy.parse({
		version: 0,
		updatedAt: now.toISOString(),
		dataTypes: DEFAULT_DATA_TYPES,
		lists: [],
		failMode: 'block'
	});
}
