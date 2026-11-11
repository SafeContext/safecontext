// Links a sign-in account (Better Auth `User`) to the `Member` row that says which organisation
// that person administers (issue #19).
import { prisma } from '#lib/server/prisma.ts';

/** The signed-in admin and their organisation. */
export type Admin = {
	memberId: string;
	email: string;
	name: string | null;
	organization: { id: string; name: string };
};

/** The admin a user is linked to, or null if they aren't a member of any organisation. */
export async function adminForUser(userId: string): Promise<Admin | null> {
	const member = await prisma.member.findUnique({
		where: { userId },
		select: {
			id: true,
			email: true,
			name: true,
			organization: { select: { id: true, name: true } }
		}
	});
	if (!member) return null;
	const { id, ...rest } = member;
	return { memberId: id, ...rest };
}

/**
 * Makes sure the user is linked to a Member. On first sign-in that means finding the Member with
 * the same email (ignoring case) that has no user yet and filling in its `userId`.
 *
 * Returns false (so sign-in is refused) when there is no such Member, or when the email matches
 * unlinked Members in more than one organisation: we won't guess which one they meant.
 *
 * Matching on email is safe because accounts can't sign themselves up: they are only created by
 * `scripts/create-admin.ts` and the seed. Adding Google or company SSO must keep that true (only
 * link verified emails).
 */
export async function linkMember(userId: string): Promise<boolean> {
	if (await prisma.member.findUnique({ where: { userId }, select: { id: true } })) return true;

	const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
	if (!user) return false;

	const candidates = await prisma.member.findMany({
		where: { userId: null, email: { equals: user.email, mode: 'insensitive' } },
		select: { id: true },
		take: 2
	});
	if (candidates.length !== 1) return false;

	// `userId: null` in the filter: if two sign-ins race, only one fills it in.
	await prisma.member.updateMany({
		where: { id: candidates[0]!.id, userId: null },
		data: { userId }
	});
	return (await prisma.member.findUnique({ where: { userId }, select: { id: true } })) !== null;
}
