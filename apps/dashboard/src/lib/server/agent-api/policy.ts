// The latest published policy for an organisation, as the agent pulls it.
import { Policy } from '@safecontext/policy';
import { prisma } from '#lib/server/prisma.ts';

/** Published versions are immutable, so the version number alone identifies the content. */
export function policyEtag(version: number): string {
	return `"policy-v${version}"`;
}

/** True if an `If-None-Match` header matches `etag` (weak comparison, as RFC 9110 asks for). */
export function etagMatches(ifNoneMatch: string | null, etag: string): boolean {
	if (!ifNoneMatch) return false;
	const strip = (tag: string) => tag.trim().replace(/^W\//, '');
	return ifNoneMatch.split(',').some((tag) => tag.trim() === '*' || strip(tag) === strip(etag));
}

/** The highest published version, validated against the contract. Null if none is published. */
export async function latestPolicy(organizationId: string): Promise<Policy | null> {
	const row = await prisma.policyVersion.findFirst({
		where: { organizationId },
		orderBy: { version: 'desc' },
		select: { version: true, snapshot: true }
	});
	if (!row) return null;

	const parsed = Policy.safeParse(row.snapshot);
	if (!parsed.success || parsed.data.version !== row.version) {
		// Publishing validates the snapshot, so this means a bug or a hand-edited row. Don't serve it.
		throw new Error(`PolicyVersion ${row.version} of organisation ${organizationId} is invalid`);
	}
	return parsed.data;
}
