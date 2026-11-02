/**
 * `mask`: keep a safe fragment ("4242 4242 4242 4242" → "****4242", SPEC.md §4).
 *
 * The last 4 characters are shown only when the value has at least `MASK_SHOW_TAIL_FROM`
 * characters, so at most a third of it is visible. Shorter values become `****` alone.
 */
export const MASK = '****';
export const MASK_SHOW_TAIL_FROM = 12;

export function mask(value: string): string {
	const chars = Array.from(value); // code points, so an emoji or accent is never split
	return chars.length >= MASK_SHOW_TAIL_FROM ? MASK + chars.slice(-4).join('') : MASK;
}
