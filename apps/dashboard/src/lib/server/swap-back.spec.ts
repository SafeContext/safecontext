// The organisation's draft swap-back tools default to the contract's default (issue #83), and a
// published policy carries them to the agent. Uses one throwaway organisation, deleted afterwards.
import { LOCAL_SWAP_BACK_TOOLS, Policy } from '@safecontext/policy';
import { afterAll, describe, expect, it } from 'vitest';
import { latestPolicy } from '#lib/server/agent-api/policy.ts';
import { prisma } from '#lib/server/prisma.ts';

const slug = `test-swap-back-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

afterAll(async () => {
	await prisma.organization.deleteMany({ where: { slug } });
});

describe('swap-back tools', () => {
	it('a new organisation starts with the local file tools, as in the contract', async () => {
		const org = await prisma.organization.create({ data: { slug, name: 'Swap-back test' } });
		expect(org.swapBackTools).toEqual([...LOCAL_SWAP_BACK_TOOLS]);
	});

	it('a published policy serves the tools it was published with, and old snapshots get the default', async () => {
		const org = await prisma.organization.findUniqueOrThrow({ where: { slug } });
		const base = {
			updatedAt: new Date().toISOString(),
			dataTypes: [{ id: 'x', name: 'X', description: '', tier: 'red', action: 'block' }]
		};
		// Version 1: published before #83, so no swapBack in the snapshot.
		await prisma.policyVersion.create({
			data: {
				organizationId: org.id,
				version: 1,
				failMode: 'block',
				snapshot: { ...base, version: 1 }
			}
		});
		expect((await latestPolicy(org.id))?.swapBack.tools).toEqual([...LOCAL_SWAP_BACK_TOOLS]);

		const v2 = Policy.parse({
			...base,
			version: 2,
			swapBack: { tools: ['Read', 'mcp__slack__*'] }
		});
		await prisma.policyVersion.create({
			data: { organizationId: org.id, version: 2, failMode: 'block', snapshot: v2 }
		});
		expect((await latestPolicy(org.id))?.swapBack.tools).toEqual(['Read', 'mcp__slack__*']);
	});
});
