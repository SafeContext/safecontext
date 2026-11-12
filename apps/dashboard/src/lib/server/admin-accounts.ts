// Creates dashboard admins: a Member of an organisation plus a Better Auth user with an email +
// password account (issue #19). Used by `scripts/create-admin.ts` and the seed, which run outside
// SvelteKit, so this file takes the Prisma client as an argument and imports nothing from `$app`.
import { hashPassword } from 'better-auth/crypto';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from './generated/prisma/client.ts';
import type { MemberRole } from './generated/prisma/enums.ts';

/** Shortest password allowed (also Better Auth's `minPasswordLength`). */
export const MIN_PASSWORD_LENGTH = 12;

/** Better Auth's provider id for email + password accounts. */
const CREDENTIAL_PROVIDER = 'credential';

export type AdminInput = {
	organizationId: string;
	email: string;
	name: string;
	password: string;
	/** Replace the password if the account already has one. Default false (leave it alone). */
	resetPassword?: boolean;
	/**
	 * `admin` (changes the policy) or `viewer` (looks only), issue #23. Set on a new member, and
	 * changed on an existing one only when given. New members default to `admin`.
	 */
	role?: MemberRole;
};

/**
 * Makes sure `email` is an admin of the organisation and can sign in with `password`.
 * Safe to re-run. Returns whether a password was set this time.
 */
export async function ensureAdmin(prisma: PrismaClient, input: AdminInput): Promise<boolean> {
	if (input.password.length < MIN_PASSWORD_LENGTH) {
		throw new Error(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters`);
	}
	// Better Auth stores and looks up emails in lower case.
	const email = input.email.trim().toLowerCase();
	const hash = await hashPassword(input.password);

	return prisma.$transaction(async (tx) => {
		const user =
			(await tx.user.findUnique({ where: { email } })) ??
			(await tx.user.create({ data: { id: randomUUID(), email, name: input.name } }));

		const member = await tx.member.findFirst({
			where: {
				organizationId: input.organizationId,
				email: { equals: email, mode: 'insensitive' }
			}
		});
		if (member?.userId && member.userId !== user.id) {
			throw new Error(`${email} is already linked to a different sign-in account`);
		}
		const linked = await tx.member.findUnique({ where: { userId: user.id } });
		if (linked && linked.organizationId !== input.organizationId) {
			throw new Error(`${email} is already an admin of another organisation`);
		}
		if (member) {
			await tx.member.update({
				where: { id: member.id },
				data: { userId: user.id, ...(input.role && { role: input.role }) }
			});
		} else {
			await tx.member.create({
				data: {
					organizationId: input.organizationId,
					email,
					name: input.name,
					userId: user.id,
					role: input.role ?? 'admin'
				}
			});
		}

		const account = await tx.account.findFirst({
			where: { userId: user.id, providerId: CREDENTIAL_PROVIDER }
		});
		if (!account) {
			await tx.account.create({
				data: {
					id: randomUUID(),
					userId: user.id,
					providerId: CREDENTIAL_PROVIDER,
					accountId: user.id,
					password: hash
				}
			});
			return true;
		}
		if (input.resetPassword || !account.password) {
			await tx.account.update({ where: { id: account.id }, data: { password: hash } });
			// A new password signs out every browser that used the old one.
			await tx.session.deleteMany({ where: { userId: user.id } });
			return true;
		}
		return false;
	});
}
