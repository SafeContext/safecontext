import { describe, expect, it } from 'vitest';
import { detectAll } from './index.ts';

/**
 * Text that looks a bit like sensitive data but is not. Tier 0 must stay quiet here: every false
 * positive is something the user is told was redacted when it was fine.
 */
const SAFE_SAMPLES: Record<string, string> = {
	'release notes and prose': `
		v2.4.1 shipped on 2024-03-05. Checkout latency fell from 480 ms to 310 ms (p95), and 12.5%
		of sessions now use the new flow. See https://example.com/docs/getting-started?ref=nav#top.
		Build 20240305.17 passed. Ping the team in #payments if the dashboard shows 3 or more alerts.
	`,
	'typescript source': `
		import { z } from 'zod';
		const API_KEY = process.env.API_KEY ?? '';
		export const Config = z.object({ port: z.number().default(4747), host: z.string() });
		const ids = [1700000000000, 1700000000001]; // epoch milliseconds
		type Pair = std::pair<int, std::string>; // c++ in a comment
		npm install react@18.2.0 @types/node@24.0.1
		<img src="logo@2x.png" srcset="logo@2x.png 2x, logo@3x.png 3x">
	`,
	'hashes and ids': `
		commit a94a8fe5ccb19ba61c4c0873d391e987982fbbd3
		sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
		uuid 123e4567-e89b-12d3-a456-426614174000
		order 4155550132 / invoice 2024-0042 / ticket ABC-1234
	`,
	'network and system output': `
		listening on 127.0.0.1:4747 and 0.0.0.0:8080
		gateway 192.168.1.1, db 10.0.0.12, subnet mask 255.255.255.0
		ipv6 loopback ::1, link-local fe80::1
		at 12:30:45 INFO started in 2.31s; mac aa:bb:cc:dd:ee:ff
	`,
	'public key and placeholders': `
		ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample user-host
		Authorization: Bearer <your-token-here>
		sk_live_xxxxxxxx  # replace with your key
	`
};

describe('safe text', () => {
	it.each(Object.entries(SAFE_SAMPLES))('flags nothing in %s', (_name, text) => {
		const flagged = detectAll(text).map((s) => text.slice(s.start, s.end));
		expect(flagged).toEqual([]);
	});
});
