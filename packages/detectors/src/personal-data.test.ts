import { describe, expect, it } from 'vitest';
import {
	cardDetector,
	emailDetector,
	hasCardBrandShape,
	ipDetector,
	passesLuhn,
	phoneDetector
} from './personal-data.ts';
import type { Detector } from './types.ts';
import { withLuhnDigit } from './test-helpers.ts';

/** The text each span covers, in the order found. */
const found = (detector: Detector, text: string) =>
	detector
		.detect(text)
		.sort((a, b) => a.start - b.start)
		.map((s) => text.slice(s.start, s.end));

describe('emailDetector', () => {
	it.each([
		'jane@northwind.com',
		'jane.doe+billing@northwind.co.uk',
		'jane_doe@mail.northwind.io',
		'J.DOE@NORTHWIND.COM',
		'josé@example.com',
		'名前@example.jp',
		'müller@münchen.de',
		'jose\u0301@example.com'
	])('finds %s', (email) => {
		expect(found(emailDetector, `contact ${email} today`)).toEqual([email]);
	});

	it('stops at the end of the address, not at sentence punctuation', () => {
		expect(found(emailDetector, 'Write to jane@northwind.com.')).toEqual(['jane@northwind.com']);
		expect(found(emailDetector, '<jane@northwind.com>, (bob@acme.org)')).toEqual([
			'jane@northwind.com',
			'bob@acme.org'
		]);
	});

	it('reports personal data spans from rules', () => {
		const [span] = emailDetector.detect('jane@northwind.com');
		expect(span).toEqual({
			start: 0,
			end: 18,
			dataTypeId: 'customer-personal-data',
			source: 'rule',
			confidence: 1
		});
	});

	it.each([
		'user@localhost',
		'a@b',
		'@mention in a chat',
		'logo@2x.png and sprite@3x.webp',
		'npm install react@18.2.0',
		'decorator @dataclass(frozen=True)',
		'email me at jane at northwind dot com',
		`${'a'.repeat(70)}@northwind.com` // not a valid address: local part over 64 characters
	])('ignores the near-miss: %s', (text) => {
		expect(emailDetector.detect(text)).toEqual([]);
	});
});

describe('phoneDetector', () => {
	it.each([
		'+44 20 7946 0958',
		'+442079460958',
		'+1 (415) 555-0132',
		'+1-415-555-0132',
		'(415) 555-0132',
		'415-555-0132',
		'415.555.0132',
		'415 555 0132',
		'07700 900123',
		'07700900123'
	])('finds %s', (phone) => {
		expect(found(phoneDetector, `Call ${phone} after lunch.`)).toContain(phone);
	});

	it('keeps the whole number in one span even when two rules match it', () => {
		const text = 'ring +1 (415) 555-0132 now';
		const spans = phoneDetector.detect(text).map((s) => text.slice(s.start, s.end));
		expect(spans.every((s) => '+1 (415) 555-0132'.includes(s))).toBe(true);
		expect(spans).toContain('+1 (415) 555-0132');
	});

	it.each([
		'2024-01-15',
		'2024-01-15T10:20:30Z',
		'version 1.2.3 and 4.15.555',
		'ssn-style 123-45-6789',
		'bare digits 4155550132',
		'order 415-555-0132-77',
		'ref ID-415-555-0132',
		'(015) 555-0132', // area codes do not start with 0 or 1
		'+5 items in the cart',
		'+12345 (too short)',
		'2.5 3.5 4.5 5.5',
		'port 8080 and 443',
		'0.1.2.3.4.5.6.7.8.9'
	])('ignores the near-miss: %s', (text) => {
		expect(phoneDetector.detect(text)).toEqual([]);
	});
});

describe('passesLuhn', () => {
	it('accepts valid numbers and rejects a changed digit', () => {
		expect(passesLuhn('4242424242424242')).toBe(true);
		expect(passesLuhn('4242424242424241')).toBe(false);
		expect(passesLuhn('')).toBe(false);
	});
});

describe('hasCardBrandShape', () => {
	it('needs a known issuer prefix with the right length', () => {
		expect(hasCardBrandShape('4242424242424242')).toBe(true);
		expect(hasCardBrandShape('4242424242424')).toBe(true); // 13-digit Visa
		expect(hasCardBrandShape('378282246310005')).toBe(true);
		expect(hasCardBrandShape('3782822463100')).toBe(false); // Amex is 15
		expect(hasCardBrandShape('1111111111111117')).toBe(false);
	});
});

describe('cardDetector', () => {
	// Published test numbers from the payment providers' documentation.
	it.each([
		['Visa', '4242424242424242'],
		['Mastercard', '5555555555554444'],
		['Mastercard 2-series', '2223003122003222'],
		['Amex', '378282246310005'],
		['Discover', '6011111111111117'],
		['JCB', '3530111333300000'],
		['Diners', '30569309025904'],
		['UnionPay', '6200000000000005']
	])('finds a %s number', (_brand, number) => {
		expect(found(cardDetector, `card ${number} on file`)).toEqual([number]);
	});

	it.each([
		['spaces', '4242 4242 4242 4242'],
		['hyphens', '4242-4242-4242-4242'],
		['Amex groups', '3782 822463 10005'],
		['Diners groups', '3056 930902 5904']
	])('finds a number written with %s', (_style, number) => {
		expect(found(cardDetector, `Card: ${number}, exp 12/30`)).toEqual([number]);
	});

	it('does not swallow a CVV written after the number', () => {
		expect(found(cardDetector, '4242 4242 4242 4242 123')).toEqual(['4242 4242 4242 4242']);
	});

	it.each([
		['fails the Luhn check', '4242424242424241'],
		['fails the Luhn check, grouped', '4242 4242 4242 4241'],
		['has no known issuer', withLuhnDigit('999999999999999')],
		['is a 13-digit timestamp', '1700000000000'],
		['is too short', '424242424242'],
		['is too long', '42424242424242424242'],
		['mixes separators', '4242-4242 4242-4242'],
		['sits inside a longer id', 'order-A4242424242424242'],
		['is a decimal', '1.4242424242424242'],
		['has uneven groups', '4242 424242 42424242']
	])('ignores a number that %s', (_why, text) => {
		expect(cardDetector.detect(`ref ${text} end`)).toEqual([]);
	});
});

describe('ipDetector', () => {
	it.each([
		'203.0.113.42',
		'8.8.8.8',
		'172.32.0.1',
		'2001:db8::8a2e:370:7334',
		'2606:4700:4700::1111'
	])('finds %s', (ip) => {
		expect(found(ipDetector, `client ${ip} connected`)).toEqual([ip]);
	});

	it('stops at sentence punctuation', () => {
		expect(found(ipDetector, 'Seen from 203.0.113.42. Later 2001:db8::1.')).toEqual([
			'203.0.113.42',
			'2001:db8::1'
		]);
	});

	it.each([
		['private 192.168', '192.168.1.10'],
		['private 10.x', '10.0.0.1'],
		['private 172.16-31', '172.16.0.1'],
		['loopback', '127.0.0.1'],
		['unspecified', '0.0.0.0'],
		['link-local', '169.254.10.20'],
		['broadcast / netmask', '255.255.255.255 and 255.255.255.0'],
		['octet out of range', '999.1.1.1 and 256.1.1.1'],
		['leading zero', '01.2.3.4'],
		['five parts', '1.2.3.4.5'],
		['a version', 'v1.2.3.4'],
		['too few parts', '203.0.113'],
		['IPv6 loopback', '::1'],
		['IPv6 link-local', 'fe80::1ff:fe23:4567:890a'],
		['IPv6 private (ULA)', 'fd12:3456:789a::1'],
		['C++ scope', 'std::string and Foo::bar'],
		['hex-looking scope', 'Add::Bad'],
		['a time', 'at 12:30:45'],
		['a MAC address', 'aa:bb:cc:dd:ee:ff']
	])('ignores %s', (_why, text) => {
		expect(ipDetector.detect(`see ${text} here`)).toEqual([]);
	});
});
