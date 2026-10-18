import { describe, expect, it } from 'vitest';
import { SECRET_RULES, secretsDetector } from './secrets.ts';
import { ALNUM, HEX, LETTERS, fill } from './test-helpers.ts';

const DIGITS10 = '1234567890';

const keyBlock = (label: string, bodyLength: number) =>
	[
		`-----${'BEGIN'} ${label}-----`,
		...Array.from({ length: Math.ceil(bodyLength / 64) }, () => fill(ALNUM, 64)),
		`-----${'END'} ${label}-----`
	].join('\n');

/**
 * One real-shaped secret and some near-misses for every rule. All built at run time (see
 * test-helpers.ts). A near-miss has the right prefix but the wrong length, alphabet or kind.
 */
const CASES: Record<string, { secret: string; nearMisses: string[] }> = {
	'aws-access-token': {
		secret: `AKIA${'IOSFODNN7EXAMPLE'}`,
		nearMisses: [
			`AKIA${'IOSFODNN7EXAMPL'}`,
			`AKIA${'iosfodnn7example'}`,
			`AKIA${'1OSFODNN7EXAMPLE'}`
		]
	},
	'github-pat': { secret: `ghp_${fill(ALNUM, 36)}`, nearMisses: [`ghp_${fill(ALNUM, 20)}`] },
	'github-fine-grained-pat': {
		secret: `github_pat_${fill(ALNUM, 82)}`,
		nearMisses: [`github_pat_${fill(ALNUM, 40)}`]
	},
	'github-oauth': { secret: `gho_${fill(ALNUM, 36)}`, nearMisses: [`gho_${fill(ALNUM, 12)}`] },
	'github-app-token': { secret: `ghs_${fill(ALNUM, 36)}`, nearMisses: [`ghs_${fill(ALNUM, 12)}`] },
	'github-refresh-token': {
		secret: `ghr_${fill(ALNUM, 36)}`,
		nearMisses: [`ghr_${fill(ALNUM, 12)}`]
	},
	'gitlab-pat': { secret: `glpat-${fill(ALNUM, 20)}`, nearMisses: [`glpat-${fill(ALNUM, 8)}`] },
	'slack-bot-token': {
		secret: `xoxb-${DIGITS10}-${DIGITS10}123-${fill(ALNUM, 24)}`,
		nearMisses: ['xoxb-123-456-abc', 'xoxb-token-placeholder']
	},
	'slack-user-token': {
		secret: `xoxp-${DIGITS10}-${DIGITS10}-${DIGITS10}-${fill(ALNUM, 30)}`,
		nearMisses: [`xoxp-${DIGITS10}-${DIGITS10}-${fill(ALNUM, 30)}`]
	},
	'slack-app-token': {
		secret: `xapp-1-A0B1C2D3-${DIGITS10}-${fill(HEX, 40)}`,
		nearMisses: ['xapp-one-A0B1C2D3-1234-abcd']
	},
	'slack-webhook-url': {
		secret: `https://hooks.slack.com/services/${fill(ALNUM, 44)}`,
		nearMisses: ['https://hooks.slack.com/services/T000/B000', 'https://api.slack.com/methods/chat']
	},
	'stripe-access-token': {
		secret: `sk_${'live'}_${fill(ALNUM, 24)}`,
		nearMisses: [
			`sk_${'live'}_short`,
			`sk_dev_${fill(ALNUM, 24)}`,
			// A publishable key is meant to be public.
			`pk_${'live'}_${fill(ALNUM, 24)}`
		]
	},
	'openai-api-key': {
		secret: `sk-${fill(ALNUM, 20)}${'T3Blbk'}FJ${fill(ALNUM, 20)}`,
		nearMisses: [`sk-${fill(ALNUM, 48)}`, `sk-${fill(ALNUM, 20)}T3BlbkFJ${fill(ALNUM, 5)}`]
	},
	'anthropic-api-key': {
		secret: `sk-ant-api03-${fill(ALNUM, 93)}AA`,
		nearMisses: [`sk-ant-api03-${fill(ALNUM, 40)}AA`, `sk-ant-${fill(ALNUM, 40)}`]
	},
	'gcp-api-key': { secret: `AIza${fill(ALNUM, 35)}`, nearMisses: [`AIza${fill(ALNUM, 12)}`] },
	'private-key': {
		secret: keyBlock('RSA PRIVATE KEY', 256),
		nearMisses: [
			// A public key is not secret.
			keyBlock('PUBLIC KEY', 256),
			// Header with nothing after it.
			`-----${'BEGIN'} RSA PRIVATE KEY-----`,
			'a private key is stored in the vault'
		]
	},
	'npm-access-token': { secret: `npm_${fill(ALNUM, 36)}`, nearMisses: [`npm_${fill(ALNUM, 12)}`] },
	'sendgrid-api-token': {
		secret: `SG.${fill(ALNUM, 66)}`,
		nearMisses: [`SG.${fill(ALNUM, 20)}`]
	},
	'twilio-api-key': {
		secret: `SK${fill(HEX, 32)}`,
		nearMisses: [`SK${fill(HEX, 20)}`, `SK${fill(HEX, 40)}`, `aSK${fill(HEX, 32)}`]
	},
	'shopify-access-token': {
		secret: `shpat_${fill(HEX, 32)}`,
		nearMisses: [`shpat_${fill(HEX, 10)}`]
	},
	jwt: {
		secret: `eyJ${fill(ALNUM, 24)}.eyJ${fill(ALNUM, 24)}.${fill(ALNUM, 30)}`,
		nearMisses: ['eyJhbGciOi.abc.def', `eyJ${fill(ALNUM, 24)}.${fill(ALNUM, 24)}`]
	},
	'digitalocean-pat': {
		secret: `dop_v1_${fill(HEX, 64)}`,
		nearMisses: [`dop_v1_${fill(HEX, 30)}`]
	},
	'huggingface-access-token': {
		secret: `hf_${fill(LETTERS, 34)}`,
		nearMisses: [`hf_${fill(LETTERS, 20)}`]
	},
	'pypi-upload-token': {
		secret: `pypi-AgEIcHlwaS5vcmc${fill(ALNUM, 60)}`,
		nearMisses: [`pypi-AgEIcHlwaS5vcmc${fill(ALNUM, 10)}`, 'pypi-simple-index']
	},
	'square-access-token': {
		secret: `sq0atp-${fill(ALNUM, 30)}`,
		nearMisses: [`sq0atp-${fill(ALNUM, 5)}`]
	},
	'databricks-api-token': {
		secret: `dapi${fill(HEX, 32)}`,
		nearMisses: [`dapi${fill(HEX, 31)}`, `dapi${fill(HEX, 32).replace('0', 'z')}`]
	}
};

describe('SECRET_RULES', () => {
	it('has a test case for every rule, and no stray cases', () => {
		expect(Object.keys(CASES).sort()).toEqual(SECRET_RULES.map((rule) => rule.id).sort());
	});

	it('uses the global flag on every rule, so each match is found', () => {
		for (const { id, regex } of SECRET_RULES) expect(regex.global, id).toBe(true);
	});
});

describe('secretsDetector', () => {
	describe.each(Object.entries(CASES))('%s', (id, { secret, nearMisses }) => {
		const rule = SECRET_RULES.find((r) => r.id === id)!;

		it('finds the secret, and exactly the secret, in surrounding text', () => {
			const text = `export TOKEN="${secret}" # see runbook`;
			const spans = secretsDetector.detect(text);
			expect(spans.map((s) => text.slice(s.start, s.end))).toContain(secret);
			for (const span of spans) {
				expect(span).toMatchObject({ dataTypeId: 'secrets', source: 'rule', confidence: 1 });
			}
		});

		it('is found by its own rule', () => {
			expect(`x ${secret} x`.match(rule.regex)).not.toBeNull();
		});

		it.each(nearMisses)('ignores the near-miss %s', (nearMiss) => {
			expect(secretsDetector.detect(`value: ${nearMiss}\n`)).toEqual([]);
		});
	});

	it('finds several secrets in one text, with their offsets', () => {
		const a = `ghp_${fill(ALNUM, 36)}`;
		const b = `AKIA${'IOSFODNN7EXAMPLE'}`;
		const text = `first ${a} then ${b}.`;
		const spans = secretsDetector.detect(text).sort((x, y) => x.start - y.start);
		expect(spans.map((s) => text.slice(s.start, s.end))).toEqual([a, b]);
	});

	it('finds the same secret again on a second call (no stale regex state)', () => {
		const text = `token ghp_${fill(ALNUM, 36)}`;
		expect(secretsDetector.detect(text)).toHaveLength(1);
		expect(secretsDetector.detect(text)).toHaveLength(1);
	});

	it('flags the whole multi-line private key block', () => {
		const key = keyBlock('OPENSSH PRIVATE KEY', 400);
		const text = `before\n${key}\nafter`;
		const [span] = secretsDetector.detect(text);
		expect(text.slice(span!.start, span!.end)).toBe(key);
	});

	it('leaves ordinary text, code and identifiers alone', () => {
		const safe = [
			'git commit a94a8fe5ccb19ba61c4c0873d391e987982fbbd3',
			'const apiKey = process.env.API_KEY;',
			'sk-learn is not a key, and neither is ask-me-anything',
			'Authorization: Bearer <token>',
			'https://hooks.slack.com/ is where webhooks live',
			'id: 123e4567-e89b-12d3-a456-426614174000'
		].join('\n');
		expect(secretsDetector.detect(safe)).toEqual([]);
	});
});
