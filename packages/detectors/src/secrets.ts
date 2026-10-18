/**
 * Secret detector: API keys, access tokens and private keys.
 *
 * The patterns in `SECRET_RULES` are a subset of the Gitleaks default rule set
 * (https://github.com/gitleaks/gitleaks, config/gitleaks.toml at v8.30.1), translated from Go
 * (RE2) to JavaScript regular expressions. Gitleaks is distributed under the MIT licence, whose
 * notice must travel with the ported rules:
 *
 *   MIT License
 *
 *   Copyright (c) 2019 Zachary Rice
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in all
 *   copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 *   SOFTWARE.
 *
 * Changes from Gitleaks: inline `(?i)` flags became explicit character classes or the `i` flag;
 * capture groups became non-capturing, and the trailing "end of token" check is a lookahead that
 * only requires the token not to continue, so a match covers exactly the secret. The private key
 * rule is a linear scan (see below). Other deliberate additions are marked "SafeContext".
 */
import { BUILTIN_DATA_TYPE } from '@safecontext/policy';
import { ruleSpan } from './spans.ts';
import type { Detector, Span } from './types.ts';

export type SecretRule = {
	/** Gitleaks rule id, so a rule can be traced back to its source. */
	id: string;
	regex: RegExp;
};

// Gitleaks ends many rules with `(?:[`'"\s;]|\\[nr]|$)`: the token must be followed by a quote,
// whitespace, `;`, an escaped newline or the end of the text. That misses a token followed by
// `,`, `)` or `.`, and here the rule is the only gate, so we only require that the token does
// not carry on (which is what stops a too-long string matching as a shorter token).
const END = String.raw`(?![\w-])`;

export const SECRET_RULES: readonly SecretRule[] = [
	{
		id: 'aws-access-token',
		regex: /\b(?:A3T[A-Z0-9]|AKIA|ASIA|ABIA|ACCA)[A-Z2-7]{16}\b/g
	},
	{ id: 'github-pat', regex: /ghp_[0-9a-zA-Z]{36}/g },
	{ id: 'github-fine-grained-pat', regex: /github_pat_\w{82}/g },
	{ id: 'github-oauth', regex: /gho_[0-9a-zA-Z]{36}/g },
	{ id: 'github-app-token', regex: /(?:ghu|ghs)_[0-9a-zA-Z]{36}/g },
	{ id: 'github-refresh-token', regex: /ghr_[0-9a-zA-Z]{36}/g },
	{ id: 'gitlab-pat', regex: /glpat-[\w-]{20}/g },
	{ id: 'slack-bot-token', regex: /xoxb-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*/g },
	{ id: 'slack-user-token', regex: /xox[pe](?:-[0-9]{10,13}){3}-[a-zA-Z0-9-]{28,34}/g },
	{ id: 'slack-app-token', regex: /xapp-\d-[A-Z0-9]+-\d+-[a-z0-9]+/gi },
	{
		id: 'slack-webhook-url',
		regex:
			/(?:https?:\/\/)?hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9+/]{43,56}/g
	},
	{
		id: 'stripe-access-token',
		regex: new RegExp(String.raw`\b(?:sk|rk)_(?:test|live|prod)_[a-zA-Z0-9]{10,99}${END}`, 'g')
	},
	{
		id: 'openai-api-key',
		regex: new RegExp(
			String.raw`\b(?:sk-(?:proj|svcacct|admin)-(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})T3BlbkFJ(?:[A-Za-z0-9_-]{74}|[A-Za-z0-9_-]{58})\b|sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20})${END}`,
			'g'
		)
	},
	{
		id: 'anthropic-api-key',
		regex: new RegExp(String.raw`\bsk-ant-api03-[a-zA-Z0-9_\-]{93}AA${END}`, 'g')
	},
	{ id: 'gcp-api-key', regex: new RegExp(String.raw`\bAIza[\w-]{35}${END}`, 'g') },
	{ id: 'npm-access-token', regex: new RegExp(String.raw`\bnpm_[a-z0-9]{36}${END}`, 'gi') },
	{
		id: 'sendgrid-api-token',
		regex: new RegExp(String.raw`\bSG\.[A-Za-z0-9=_\-.]{66}${END}`, 'g')
	},
	// SafeContext: Gitleaks has no boundaries here, which matches inside longer hex strings.
	{ id: 'twilio-api-key', regex: /\bSK[0-9a-fA-F]{32}(?![0-9a-fA-F])/g },
	{ id: 'shopify-access-token', regex: /shpat_[a-fA-F0-9]{32}/g },
	{
		id: 'jwt',
		regex: new RegExp(
			String.raw`\bey[a-zA-Z0-9]{17,}\.ey[a-zA-Z0-9\/\\_-]{17,}\.(?:[a-zA-Z0-9\/\\_-]{10,}={0,2})?${END}`,
			'g'
		)
	},
	{ id: 'digitalocean-pat', regex: new RegExp(String.raw`\bdop_v1_[a-f0-9]{64}${END}`, 'g') },
	{ id: 'huggingface-access-token', regex: new RegExp(String.raw`\bhf_[A-Za-z]{34}${END}`, 'g') },
	{ id: 'pypi-upload-token', regex: /pypi-AgEIcHlwaS5vcmc[\w-]{50,1000}/g },
	{
		id: 'square-access-token',
		regex: new RegExp(String.raw`\b(?:EAAA|sq0atp-)[\w-]{22,60}${END}`, 'g')
	},
	{
		id: 'databricks-api-token',
		regex: new RegExp(String.raw`\bdapi[a-f0-9]{32}(?:-\d)?${END}`, 'g')
	}
];

// ---------------------------------------------------------------------------------------------
// Private keys
// ---------------------------------------------------------------------------------------------
// Gitleaks' `private-key` rule is one lazy regex from the header to the footer. On text with many
// headers and no footer that is quadratic, and a key cut off before its footer (tool output is
// often truncated) is missed altogether, leaving the key material exposed. So this rule is a
// linear scan instead: find a header, take the key-looking lines after it, and flag them up to
// the footer, or up to the end of the lines if the footer is missing.

export const PRIVATE_KEY_RULE_ID = 'private-key';

const KEY_LABEL = String.raw`[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?`;
const KEY_HEADER = new RegExp(String.raw`-----BEGIN${KEY_LABEL}-----`, 'gi');
const KEY_FOOTER_SOURCE = String.raw`-----END${KEY_LABEL}-----`;
// Line breaks, including the two characters `\n` when a key sits inside a JSON string.
const BREAKS = String.raw`(?:\s|\\[nr])*`;
const KEY_FOOTER = new RegExp(`${BREAKS}${KEY_FOOTER_SOURCE}`, 'iy');
// Each item starts with a non-space, non-backslash character, so the loop cannot match one line
// two ways. Items: a PEM header line (`Proc-Type: 4,ENCRYPTED`), a base64 line (16+ characters),
// or a short last line when the footer or the end of the text follows.
const KEY_BODY = new RegExp(
	String.raw`(?:${BREAKS}(?:[A-Za-z][A-Za-z-]*:[^\n\\]*|[A-Za-z0-9+/=]{16,}|[A-Za-z0-9+/=]{1,15}(?=${BREAKS}${KEY_FOOTER_SOURCE}|$)))*`,
	'iy'
);
const MIN_KEY_MATERIAL = 16;

/** Offsets `[start, end)` of every private key in `text`, whole or cut off. */
export function findPrivateKeys(text: string): Array<[start: number, end: number]> {
	const found: Array<[number, number]> = [];
	KEY_HEADER.lastIndex = 0;
	for (let header = KEY_HEADER.exec(text); header !== null; header = KEY_HEADER.exec(text)) {
		const bodyStart = header.index + header[0].length;
		KEY_BODY.lastIndex = bodyStart;
		KEY_BODY.exec(text); // can match nothing, never fails
		const bodyEnd = KEY_BODY.lastIndex;
		const material = text.slice(bodyStart, bodyEnd).replace(/\s|\\[nr]/g, '').length;
		if (material < MIN_KEY_MATERIAL) {
			KEY_HEADER.lastIndex = bodyStart; // a header with no key after it: nothing to hide
			continue;
		}
		KEY_FOOTER.lastIndex = bodyEnd;
		const end = KEY_FOOTER.exec(text) === null ? bodyEnd : KEY_FOOTER.lastIndex;
		found.push([header.index, end]);
		KEY_HEADER.lastIndex = end;
	}
	return found;
}

export const secretsDetector: Detector = {
	id: 'secrets',
	detect(text) {
		const spans: Span[] = [];
		for (const { regex } of SECRET_RULES) {
			for (const m of text.matchAll(regex)) {
				spans.push(ruleSpan(m.index, m.index + m[0].length, BUILTIN_DATA_TYPE.secrets));
			}
		}
		for (const [start, end] of findPrivateKeys(text)) {
			spans.push(ruleSpan(start, end, BUILTIN_DATA_TYPE.secrets));
		}
		return spans;
	}
};
