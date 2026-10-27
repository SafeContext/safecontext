import { describe, expect, it } from 'vitest';
import { etagMatches, policyEtag } from './policy.ts';
import { RateLimiter } from './rate-limit.ts';
import { hashSecret, isSecret, newSecret, uuidv7 } from './secrets.ts';

describe('secrets', () => {
	it('makes prefixed, distinct secrets and recognises their kind', () => {
		const a = newSecret('deviceToken');
		const b = newSecret('deviceToken');
		expect(a).toMatch(/^scd_[A-Za-z0-9_-]{43}$/);
		expect(a).not.toBe(b);
		expect(isSecret('deviceToken', a)).toBe(true);
		expect(isSecret('enrollmentKey', a)).toBe(false);
		expect(isSecret('deviceToken', 'scd_short')).toBe(false);
	});

	it('hashes to lowercase hex SHA-256', () => {
		expect(hashSecret('abc')).toBe(
			'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
		);
	});

	it('makes version 7 UUIDs that start with the timestamp', () => {
		const id = uuidv7(0x0123456789ab);
		expect(id).toMatch(/^01234567-89ab-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
	});
});

describe('etagMatches', () => {
	const etag = policyEtag(3);
	it('matches exact, weak, listed and wildcard tags', () => {
		expect(etagMatches(etag, etag)).toBe(true);
		expect(etagMatches(`W/${etag}`, etag)).toBe(true);
		expect(etagMatches(`"x", ${etag}`, etag)).toBe(true);
		expect(etagMatches('*', etag)).toBe(true);
	});
	it('does not match other versions or nothing', () => {
		expect(etagMatches(policyEtag(2), etag)).toBe(false);
		expect(etagMatches(null, etag)).toBe(false);
	});
});

describe('RateLimiter', () => {
	it('allows a burst, then asks the client to wait until a request refills', () => {
		let now = 0;
		const limiter = new RateLimiter(2, 6, () => now); // one request per 10 s
		expect(limiter.take('a')).toBe(0);
		expect(limiter.take('a')).toBe(0);
		expect(limiter.take('a')).toBe(10);
		expect(limiter.take('b')).toBe(0); // keys are independent
		now += 10_000;
		expect(limiter.check('a')).toBe(0);
		expect(limiter.take('a')).toBe(0);
		expect(limiter.take('a')).toBeGreaterThan(0);
	});
});
