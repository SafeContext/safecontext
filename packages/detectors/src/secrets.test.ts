import { describe, expect, it } from 'vitest';
import { PRIVATE_KEY_RULE_ID, SECRET_RULES, findKeyedTokens, findPrivateKeys, secretsDetector } from './secrets.ts';
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
		// A shorter sk-ant-api03- key is caught by anthropic-prefixed-key instead (#111).
		nearMisses: [`sk-ant-${fill(ALNUM, 40)}`]
	},
	'gcp-api-key': {
		secret: `AIza${fill(ALNUM, 35)}`,
		nearMisses: [`AIza${fill(ALNUM, 12)}`, `AIza${fill(ALNUM, 50)}`]
	},
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
	'npm-access-token': {
		secret: `npm_${fill(ALNUM, 36)}`,
		nearMisses: [`npm_${fill(ALNUM, 12)}`, `npm_${fill(ALNUM, 44)}`]
	},
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
	'jwt-any-payload': {
		secret: `eyJ${fill(ALNUM, 24)}.${fill(ALNUM, 30)}.${fill(ALNUM, 30)}`,
		nearMisses: [`eyJ${fill(ALNUM, 24)}.${fill(ALNUM, 24)}`, 'eyJhbGciOi.abcdefghijkl.mnopqrstuvwx']
	},
	'openai-prefixed-key': {
		secret: `sk-${'proj'}-${fill(ALNUM, 48)}`,
		nearMisses: [`sk-${'proj'}-${fill(ALNUM, 10)}`, 'sk-project-management']
	},
	'anthropic-prefixed-key': {
		secret: `sk-${'ant'}-api03-${fill(ALNUM, 40)}`,
		nearMisses: [`sk-${'ant'}-api03-${fill(ALNUM, 8)}`, 'sk-ant-colony']
	},
	'aws-secret-key-shape': {
		secret: `re+UBWs49aLReufIgf6v${'wTRz3+ykGxFNIOIC31qo'}`,
		nearMisses: [
			`re8UBWs49aLReufIgf6v${'wTRz38ykGxFNIOIC31qo'}`,
			`re+UBWs49aLReufIgf6v${'wTRz3+ykGxFNIOIC31q'}`,
			`re+UBWs49aLReufIgf6v${'wTRz3+ykGxFNIOIC31qoX'}`,
			`a94a8fe5ccb19ba61c4c/${'0873d391e987982fbbd3'}`.slice(0, 40)
		]
	},
	'connection-string-password': {
		secret: `postgresql://reporting_ro:${'Z4tij2DD'}N#Gv^@orders-4.internal.example.io:5432/billing`,
		nearMisses: [
			'postgres://orders@db.internal:5432/orders',
			'postgres://db.internal/orders',
			'postgres://app:${DB_PASSWORD}@db.internal/app',
			'mysql://app:<password>@db/app',
			'redis://:****@cache:6379',
			'postgres://app:$DB_PASSWORD@db.internal/app'
		]
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
		expect(Object.keys(CASES).sort()).toEqual(
			[...SECRET_RULES.map((rule) => rule.id), PRIVATE_KEY_RULE_ID].sort()
		);
	});

	it('uses the global flag on every rule, so each match is found', () => {
		for (const { id, regex } of SECRET_RULES) expect(regex.global, id).toBe(true);
	});
});

describe('secretsDetector', () => {
	describe.each(Object.entries(CASES))('%s', (id, { secret, nearMisses }) => {
		const rule = SECRET_RULES.find((r) => r.id === id);

		it('finds the secret, and exactly the secret, in surrounding text', () => {
			const text = `export TOKEN="${secret}" # see runbook`;
			const spans = secretsDetector.detect(text);
			expect(spans.map((s) => text.slice(s.start, s.end))).toContain(secret);
			for (const span of spans) {
				expect(span).toMatchObject({ dataTypeId: 'secrets', source: 'rule', confidence: 1 });
			}
		});

		it.skipIf(rule === undefined)('is found by its own rule', () => {
			expect(`x ${secret} x`.match(rule!.regex)).not.toBeNull();
		});

		it.each([',', ')', ']', '}', '.', ':', '>', "'", '"'])(
			'finds the secret when it is followed by %s',
			(after) => {
				const text = `see (${secret}${after}rest`;
				expect(secretsDetector.detect(text).map((s) => text.slice(s.start, s.end))).toContain(
					secret
				);
			}
		);

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

	describe('private keys', () => {
		const header = (label = 'RSA PRIVATE KEY') => `-----${'BEGIN'} ${label}-----`;
		const footer = (label = 'RSA PRIVATE KEY') => `-----${'END'} ${label}-----`;
		const lines = (n: number) => Array.from({ length: n }, () => fill(ALNUM, 64));
		const flagged = (text: string) => findPrivateKeys(text).map(([a, b]) => text.slice(a, b));

		it('flags the whole multi-line block, header to footer', () => {
			const key = keyBlock('OPENSSH PRIVATE KEY', 400);
			const text = `before\n${key}\nafter`;
			const [span] = secretsDetector.detect(text);
			expect(text.slice(span!.start, span!.end)).toBe(key);
		});

		it('flags a key that is cut off before its footer', () => {
			const partial = [header(), ...lines(3), fill(ALNUM, 20)].join('\n');
			expect(flagged(`output:\n${partial}`)).toEqual([partial]);
			// Cut off in the middle of a line, with Windows line endings.
			const crlf = [header(), ...lines(2), fill(ALNUM, 7)].join('\r\n');
			expect(flagged(crlf)).toEqual([crlf]);
		});

		it('keeps the key-looking lines only, not the prose after a cut-off key', () => {
			const partial = [header(), ...lines(2)].join('\n');
			expect(flagged(`${partial}\nThat was the key, please rotate it.`)).toEqual([partial]);
		});

		it('flags an encrypted key with its PEM header lines', () => {
			const key = [
				header(),
				'Proc-Type: 4,ENCRYPTED',
				'DEK-Info: AES-128-CBC,0123456789ABCDEF0123456789ABCDEF',
				'',
				...lines(2),
				fill(ALNUM, 12),
				footer()
			].join('\n');
			expect(flagged(`x\n${key}\ny`)).toEqual([key]);
		});

		it('flags a key stored in a JSON string with escaped newlines', () => {
			const key = [header(), ...lines(2), footer()].join('\\n');
			const text = `{"private_key": "${key}\\n", "id": 1}`;
			expect(flagged(text)).toEqual([key]);
		});

		it('flags every key in the text', () => {
			const a = [header(), ...lines(2), footer()].join('\n');
			const b = [header('PRIVATE KEY'), ...lines(2), footer('PRIVATE KEY')].join('\n');
			expect(flagged(`${a}\n\nand\n\n${b}`)).toEqual([a, b]);
		});

		it.each([
			['a bare header', header()],
			['a header followed by prose', `${header()}\nsee the vault for the real thing`],
			['an empty key', `${header()}\n${footer()}`],
			['a placeholder', `${header()}\n...\n${footer()}`],
			['a public key', keyBlock('PUBLIC KEY', 256)],
			['a certificate', keyBlock('CERTIFICATE', 256)]
		])('ignores %s', (_what, text) => {
			expect(findPrivateKeys(text)).toEqual([]);
		});
	});

	describe('connection strings (#111)', () => {
		it.each([
			`mongodb+srv://app:${'lkxpJuTh'}S5U&xzF8^@db-prod-6.internal.example.io/app`,
			`mysql://root:${'s3cr3t'}!@10.0.0.5:3306`,
			`redis://:${'hunter2hunter2'}@cache.internal:6379/0`,
			`amqps://svc:${'p4ss'}word@mq.example.com/vhost`,
			`postgres://u:${'$ecret1'}@db.host/app`,
			`postgres://u:${'*pass9'}@db.host/app`,
			`postgres://u:${'pa/ss'}@db.host/app`,
			`postgres://u:${'p@ss'}@db.host/app`
		])('finds %s, the whole URL', (url) => {
			const text = `DATABASE_URL=${url}\nnext line`;
			expect(secretsDetector.detect(text).map((s) => text.slice(s.start, s.end))).toEqual([url]);
		});
	});

	describe('keyed tokens (#111)', () => {
		const token = `dPCWR4cK${fill(ALNUM, 32)}`;
		it.each([
			`Rotated ${token} after the incident.`,
			`api_key: "${token}"`,
			`client_secret=${token}`,
			`The token was ${token}`,
			`AWS_SECRET = "${token}"`,
			`the leaked key, ${token}, was rotated`
		])(
			'finds the token in: %s',
			(text) => {
				expect(findKeyedTokens(text).map(([a, b]) => text.slice(a, b))).toEqual([token]);
			}
		);
		it.each([
			`commit a94a8fe5ccb19ba61c4c0873d391e987982fbbd3`,
			`token: ${'a'.repeat(40)}`,
			`the secret is out of the bag`,
			`the key point: ${'a'.repeat(10)}`,
			`keyboard ${token}`,
			`token = process.env.SLACK_SIGNING_SECRET_FOR_THE_ORDERS_APP`,
			`Rotated ${token.slice(0, 20)}`
		])('ignores: %s', (text) => {
			expect(findKeyedTokens(text)).toEqual([]);
		});
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
