/**
 * Personal data detectors: email addresses, phone numbers, payment card numbers and IP addresses.
 * All of them report `BUILTIN_DATA_TYPE.personalData`.
 *
 * Each detector is deliberately conservative: a regex finds candidates, then a check (Luhn,
 * octet range, digit count...) throws out the look-alikes that clutter code and logs.
 */
import { isIPv6 } from 'node:net';
import { BUILTIN_DATA_TYPE } from '@safecontext/policy';
import { ruleSpan } from './spans.ts';
import type { Detector, Span } from './types.ts';

const PERSONAL = BUILTIN_DATA_TYPE.personalData;

/**
 * Run `regex` over `text`; every match that passes `accept` becomes a personal data span.
 * `regex` must have the `g` flag.
 */
function scan(text: string, regex: RegExp, accept?: (match: string) => boolean): Span[] {
	const spans: Span[] = [];
	for (const m of text.matchAll(regex)) {
		if (accept === undefined || accept(m[0])) {
			spans.push(ruleSpan(m.index, m.index + m[0].length, PERSONAL));
		}
	}
	return spans;
}

const digitsOf = (value: string) => value.replace(/\D/g, '');

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

// Lengths are bounded (RFC 5321 limits) and the lookbehind stops the scan restarting inside a
// long run of letters, so a 5 KB blob with no `@` costs one pass, not thousands. Letters, marks
// and digits are Unicode-aware (`josé@example.com`, `名前@example.jp`, `müller@münchen.de`). A
// local part over 64 characters is not a valid address and is not flagged.
const EMAIL =
	/(?<![\p{L}\p{M}\p{N}_.%+-])[\p{L}\p{M}\p{N}_.%+-]{1,64}@(?:[\p{L}\p{M}\p{N}-]{1,63}\.){1,8}\p{L}{2,24}(?![\p{L}\p{M}\p{N}-])/gu;

// `logo@2x.png`, `sprite@3x.webp`: image names that look like emails.
const FILE_EXTENSIONS = new Set([
	'png',
	'jpg',
	'jpeg',
	'gif',
	'webp',
	'svg',
	'avif',
	'ico',
	'bmp',
	'tiff',
	'css',
	'js',
	'mjs'
]);

export const emailDetector: Detector = {
	id: 'email',
	detect(text) {
		return scan(text, EMAIL, (email) => {
			const tld = email.slice(email.lastIndexOf('.') + 1).toLowerCase();
			return !FILE_EXTENSIONS.has(tld);
		});
	}
};

// ---------------------------------------------------------------------------------------------
// Phone numbers
// ---------------------------------------------------------------------------------------------

// International: `+` then 8-15 digits (the E.164 maximum) with spaces, dots, dashes or brackets.
const PHONE_INTERNATIONAL = /(?<![\w+])\+\d[\d ().-]{6,22}\d(?!\w)/g;
// North America: area code and exchange start 2-9; the separators are required, so a bare
// ten-digit number is not flagged.
const PHONE_NANP =
	/(?<![\w.+-])(?:\+?1[ .-])?(?:\([2-9]\d{2}\)[ .-]?|[2-9]\d{2}[ .-])[2-9]\d{2}[ .-]\d{4}(?![\w-])/g;
// UK mobile in national format: 07700 900123.
const PHONE_UK_MOBILE = /(?<![\w.+-])07\d{3}[ -]?\d{3}[ -]?\d{3}(?!\w)/g;

export const phoneDetector: Detector = {
	id: 'phone',
	detect(text) {
		return [
			...scan(text, PHONE_INTERNATIONAL, (value) => {
				const digits = digitsOf(value).length;
				return digits >= 8 && digits <= 15;
			}),
			...scan(text, PHONE_NANP),
			...scan(text, PHONE_UK_MOBILE)
		];
	}
};

// ---------------------------------------------------------------------------------------------
// Payment card numbers
// ---------------------------------------------------------------------------------------------

/** Luhn checksum, the check digit every real card number carries. `digits` is digits only. */
export function passesLuhn(digits: string): boolean {
	let sum = 0;
	let double = false;
	for (let i = digits.length - 1; i >= 0; i--) {
		let d = digits.charCodeAt(i) - 48;
		if (double) {
			d *= 2;
			if (d > 9) d -= 9;
		}
		sum += d;
		double = !double;
	}
	return digits.length > 0 && sum % 10 === 0;
}

const inRange = (digits: string, length: number, from: number, to: number) => {
	const prefix = Number(digits.slice(0, length));
	return prefix >= from && prefix <= to;
};

/** Issuer prefix and length. A number must look like a real card brand, not just pass Luhn. */
export function hasCardBrandShape(d: string): boolean {
	const n = d.length;
	if (d.startsWith('4')) return n === 13 || n === 16 || n === 19; // Visa
	if (inRange(d, 2, 51, 55) || inRange(d, 4, 2221, 2720)) return n === 16; // Mastercard
	if (d.startsWith('34') || d.startsWith('37')) return n === 15; // American Express
	if (n < 16 || n > 19) {
		// Diners Club: 300-305, 36, 38, 39. Usually 14 digits.
		return n === 14 && (inRange(d, 3, 300, 305) || d.startsWith('36') || inRange(d, 2, 38, 39));
	}
	return (
		d.startsWith('6011') || // Discover
		d.startsWith('65') ||
		inRange(d, 3, 644, 649) ||
		inRange(d, 6, 622126, 622925) ||
		inRange(d, 4, 3528, 3589) || // JCB
		d.startsWith('62') || // UnionPay
		inRange(d, 3, 300, 305) ||
		d.startsWith('36') ||
		inRange(d, 2, 38, 39)
	);
}

const CARD_CONTIGUOUS = /(?<![\w.-])\d{13,19}(?![\w-])/g;
// 4-4-4-(1..7), e.g. 4242 4242 4242 4242, with one consistent separator.
const CARD_GROUPED = /(?<![\w.-])\d{4}([ -])\d{4}\1\d{4}\1\d{1,7}(?![\w-])/g;
// 4-6-5 (American Express) and 4-6-4 (Diners Club).
const CARD_GROUPED_LONG = /(?<![\w.-])\d{4}([ -])\d{6}\1\d{4,5}(?![\w-])/g;

const isCardNumber = (value: string) => {
	const digits = digitsOf(value);
	return hasCardBrandShape(digits) && passesLuhn(digits);
};

export const cardDetector: Detector = {
	id: 'card',
	detect(text) {
		return [
			...scan(text, CARD_CONTIGUOUS, isCardNumber),
			...scan(text, CARD_GROUPED, isCardNumber),
			...scan(text, CARD_GROUPED_LONG, isCardNumber)
		];
	}
};

// ---------------------------------------------------------------------------------------------
// IP addresses
// ---------------------------------------------------------------------------------------------

// The lookbehind skips `v1.2.3.4`; the lookahead skips `1.2.3.4.5`.
const IPV4 = /(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?!\w|\.\d)/g;

/**
 * IPv4 that could identify a person: a valid dotted quad outside the loopback, private,
 * link-local and multicast/reserved ranges (those name machines on someone's own network).
 */
function isPublicIpv4(value: string): boolean {
	const parts = value.split('.');
	const octets: number[] = [];
	for (const part of parts) {
		if (part.length > 1 && part.startsWith('0')) return false; // 010.1.1.1 is not a normal quad
		const octet = Number(part);
		if (octet > 255) return false;
		octets.push(octet);
	}
	const [a, b] = octets as [number, number, number, number];
	if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
	if (a === 169 && b === 254) return false;
	if (a === 172 && b >= 16 && b <= 31) return false;
	if (a === 192 && b === 168) return false;
	return true;
}

// Candidates only; `isIPv6` decides. Word characters on either side rule out `std::string`.
const IPV6 = /(?<![\w:])(?:[0-9A-Fa-f]{0,4}:){2,7}[0-9A-Fa-f]{0,4}(?![\w:])(?!\.\d)/g;

function isPublicIpv6(value: string): boolean {
	// Needs a digit: `Add::Bad` in source code is a valid IPv6 address, but not an address.
	if (!/\d/.test(value) || !isIPv6(value)) return false;
	const first = value.split(':')[0]!.toLowerCase();
	if (first === '') return false; // ::1 (loopback), :: (unspecified) and other `::`-led forms
	const hextet = parseInt(first, 16);
	if (hextet >= 0xfe80 && hextet <= 0xfebf) return false; // link-local
	if (hextet >= 0xfc00 && hextet <= 0xfdff) return false; // unique local (private)
	if (hextet >= 0xff00) return false; // multicast
	return true;
}

export const ipDetector: Detector = {
	id: 'ip',
	detect(text) {
		return [...scan(text, IPV4, isPublicIpv4), ...scan(text, IPV6, isPublicIpv6)];
	}
};
