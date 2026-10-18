/**
 * Helpers for building test inputs. Fake secrets are assembled at run time from short pieces so
 * no realistic-looking key ever appears in the source (GitHub push protection would block it).
 */

export const ALNUM = 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC';
export const HEX = '0123456789abcdef';
export const LETTERS = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ';

/** `length` characters cycling through `alphabet`. Deterministic, so failures are repeatable. */
export function fill(alphabet: string, length: number): string {
	let out = '';
	while (out.length < length) out += alphabet;
	return out.slice(0, length);
}

/** Append the Luhn check digit to `body` (digits only), giving a number that passes Luhn. */
export function withLuhnDigit(body: string): string {
	for (let check = 0; check < 10; check++) {
		const candidate = `${body}${check}`;
		let sum = 0;
		let double = false;
		for (let i = candidate.length - 1; i >= 0; i--) {
			let d = Number(candidate[i]);
			if (double) {
				d *= 2;
				if (d > 9) d -= 9;
			}
			sum += d;
			double = !double;
		}
		if (sum % 10 === 0) return candidate;
	}
	throw new Error('unreachable');
}
