// Device tokens and enrollment keys. Only their SHA-256 hashes are stored, so a database leak
// doesn't hand out working credentials. Both are 256-bit random values, so a plain (unsalted,
// fast) hash is enough: there is nothing to brute-force.
//
// No `$app/*` imports here: `scripts/enrollment-key.ts` runs this file directly with Node.
import { createHash, randomBytes } from 'node:crypto';

/** Prefixes make a leaked secret easy to recognise (and to scan for) and stop mix-ups. */
export const SECRET_PREFIX = { deviceToken: 'scd_', enrollmentKey: 'sce_' } as const;
export type SecretKind = keyof typeof SECRET_PREFIX;

const SECRET_BODY = /^[A-Za-z0-9_-]{43}$/;

/** A new random secret: prefix + 32 random bytes as base64url (43 chars). */
export function newSecret(kind: SecretKind): string {
	return SECRET_PREFIX[kind] + randomBytes(32).toString('base64url');
}

/** True if `value` looks like a secret of this kind (cheap check before touching the database). */
export function isSecret(kind: SecretKind, value: string): boolean {
	const prefix = SECRET_PREFIX[kind];
	return value.startsWith(prefix) && SECRET_BODY.test(value.slice(prefix.length));
}

/** Lowercase hex SHA-256, as stored in `Device.tokenHash` and `Organization.enrollmentKeyHash`. */
export function hashSecret(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * A UUIDv7 (RFC 9562), the same kind of id Prisma's `@default(uuid(7))` makes. We create event
 * ids up front so a whole batch, with its counts, can be inserted with two `createMany` calls.
 */
export function uuidv7(now: number = Date.now()): string {
	const b = randomBytes(16);
	b.writeUIntBE(now, 0, 6);
	b[6] = (b[6]! & 0x0f) | 0x70;
	b[8] = (b[8]! & 0x3f) | 0x80;
	const h = b.toString('hex');
	return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
