// The editable (draft) policy and publishing it (issue #23).
//
// The draft lives in ordinary rows: `DataType` (+ `TermList`) and the organisation's `failMode`
// and `swapBackTools`. Every edit on the Policy page changes those rows straight away; agents
// don't see anything until an admin publishes, which copies the draft into a new, immutable
// `PolicyVersion` (what `GET /api/policy` serves). "Discard changes" puts the draft back to the
// latest published version.
//
// Every function takes the organisation id from `currentOrganization()`, never from the request.
import {
	DataType as DataTypeContract,
	FailMode,
	Policy,
	SwapBack,
	type Action,
	type Tier
} from '@safecontext/policy';
import {
	actionFor,
	type BoardTier,
	columnFor,
	isBuiltin,
	keyFromName,
	LIMITS,
	parseTerms,
	shownAction
} from '#lib/policy-board.ts';
import { latestPolicy } from '#lib/server/agent-api/policy.ts';
import { prisma } from '#lib/server/prisma.ts';
import { Prisma } from './generated/prisma/client.ts';

/** A problem with an edit, worded for the admin. */
export class DraftError extends Error {}

export type DraftDataType = {
	key: string;
	name: string;
	description: string;
	examples: string[];
	tier: Tier;
	action: Action;
	terms: string[];
};

export type Draft = {
	/** Ordered by column, then by position within the column. */
	dataTypes: DraftDataType[];
	failMode: FailMode;
	swapBackTools: string[];
};

export async function loadDraft(organizationId: string): Promise<Draft> {
	const org = await prisma.organization.findUniqueOrThrow({
		where: { id: organizationId },
		select: {
			failMode: true,
			swapBackTools: true,
			dataTypes: {
				// Postgres sorts an enum in declaration order: green, yellow, red.
				orderBy: [{ tier: 'asc' }, { position: 'asc' }, { createdAt: 'asc' }],
				select: {
					key: true,
					name: true,
					description: true,
					examples: true,
					tier: true,
					action: true,
					termList: { select: { terms: true } }
				}
			}
		}
	});
	return {
		failMode: org.failMode,
		swapBackTools: org.swapBackTools,
		dataTypes: org.dataTypes.map(({ termList, ...dt }) => ({ ...dt, terms: termList?.terms ?? [] }))
	};
}

/** The draft as a complete policy, validated against the contract. Throws `DraftError` if invalid. */
export function policyFromDraft(draft: Draft, version: number, updatedAt: Date): Policy {
	const parsed = Policy.safeParse({
		version,
		updatedAt: updatedAt.toISOString(),
		dataTypes: draft.dataTypes.map((dt) => ({
			id: dt.key,
			name: dt.name,
			description: dt.description,
			examples: dt.examples,
			tier: dt.tier,
			action: dt.action
		})),
		lists: draft.dataTypes
			.filter((dt) => dt.terms.length > 0)
			.map((dt) => ({ dataTypeId: dt.key, terms: dt.terms })),
		failMode: draft.failMode,
		swapBack: { tools: draft.swapBackTools }
	});
	if (!parsed.success) {
		throw new DraftError(`The policy isn't valid yet: ${parsed.error.issues[0]?.message}`);
	}
	return parsed.data;
}

/**
 * What a policy does, ignoring its version, date and the order of data types and lists (order
 * only matters on the board). Two policies with the same content behave the same.
 */
function content(policy: Policy): string {
	const byId = <T extends { id?: string; dataTypeId?: string }>(a: T, b: T) =>
		(a.id ?? a.dataTypeId ?? '').localeCompare(b.id ?? b.dataTypeId ?? '');
	return JSON.stringify({
		dataTypes: [...policy.dataTypes].sort(byId),
		lists: [...policy.lists].sort(byId),
		failMode: policy.failMode,
		swapBack: policy.swapBack
	});
}

export type DraftStatus = {
	published: { version: number; publishedAt: Date; publishedBy: string | null } | null;
	/** True if publishing now would change what agents do. */
	changed: boolean;
};

export async function draftStatus(organizationId: string, draft: Draft): Promise<DraftStatus> {
	const [policy, row] = await Promise.all([
		latestPolicy(organizationId),
		prisma.policyVersion.findFirst({
			where: { organizationId },
			orderBy: { version: 'desc' },
			select: {
				version: true,
				publishedAt: true,
				publishedBy: { select: { name: true, email: true } }
			}
		})
	]);
	if (!policy || !row) return { published: null, changed: true };
	let changed = true;
	try {
		changed = content(policyFromDraft(draft, 0, new Date())) !== content(policy);
	} catch (e) {
		if (!(e instanceof DraftError)) throw e;
	}
	return {
		published: {
			version: row.version,
			publishedAt: row.publishedAt,
			publishedBy: row.publishedBy ? (row.publishedBy.name ?? row.publishedBy.email) : null
		},
		changed
	};
}

async function findDataType(organizationId: string, key: string) {
	const dt = await prisma.dataType.findUnique({
		where: { organizationId_key: { organizationId, key } },
		select: { id: true, tier: true, action: true, name: true }
	});
	if (!dt) throw new DraftError('That data type no longer exists. Reload the page.');
	return dt;
}

/**
 * Moves a data type to `tier`, before `beforeKey` (or to the end of the column). Its action
 * becomes one the new column offers (`actionFor`).
 */
export async function moveDataType(
	organizationId: string,
	key: string,
	tier: BoardTier,
	beforeKey: string | null
): Promise<void> {
	const dt = await findDataType(organizationId, key);
	await prisma.$transaction((tx) => placeInColumn(tx, organizationId, dt, tier, beforeKey));
}

/** Puts `dt` in `tier` before `beforeKey` (or last), renumbering that column. */
async function placeInColumn(
	tx: Prisma.TransactionClient,
	organizationId: string,
	dt: { id: string; action: Action },
	tier: BoardTier,
	beforeKey: string | null
): Promise<void> {
	const column = await tx.dataType.findMany({
		where: { organizationId, tier, NOT: { id: dt.id } },
		orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
		select: { id: true, key: true }
	});
	const at = beforeKey ? column.findIndex((c) => c.key === beforeKey) : -1;
	const ordered = column.map((c) => c.id);
	ordered.splice(at === -1 ? ordered.length : at, 0, dt.id);
	await tx.dataType.update({
		where: { id: dt.id },
		data: { tier, action: actionFor(tier, dt.action) }
	});
	for (const [position, id] of ordered.entries()) {
		await tx.dataType.update({ where: { id }, data: { position } });
	}
}

export type DataTypeInput = {
	name: string;
	description: string;
	/** Word list, one term per line. */
	terms: string;
};

function cleanInput(input: DataTypeInput) {
	const name = input.name.trim().replace(/\s+/g, ' ');
	const description = input.description.trim();
	const terms = parseTerms(input.terms);
	if (!name) throw new DraftError('Give the data type a name.');
	if (name.length > LIMITS.name)
		throw new DraftError(`Names can be up to ${LIMITS.name} characters.`);
	if (description.length > LIMITS.description) {
		throw new DraftError(`Descriptions can be up to ${LIMITS.description} characters.`);
	}
	const long = terms.find((t) => t.length > LIMITS.term);
	if (long) throw new DraftError(`Each word list entry can be up to ${LIMITS.term} characters.`);
	if (terms.length > LIMITS.terms) {
		throw new DraftError(`A word list can have up to ${LIMITS.terms} entries.`);
	}
	return { name, description, terms };
}

/** Names must differ (ignoring case): the tier 1 model tells data types apart by name. */
async function assertNameFree(organizationId: string, name: string, exceptId?: string) {
	const clash = await prisma.dataType.findFirst({
		where: {
			organizationId,
			name: { equals: name, mode: 'insensitive' },
			...(exceptId && { NOT: { id: exceptId } })
		},
		select: { id: true }
	});
	if (clash) throw new DraftError(`There is already a data type called "${name}".`);
}

async function saveTerms(tx: Prisma.TransactionClient, dataTypeId: string, terms: string[]) {
	if (terms.length === 0) {
		await tx.termList.deleteMany({ where: { dataTypeId } });
	} else {
		await tx.termList.upsert({
			where: { dataTypeId },
			update: { terms },
			create: { dataTypeId, terms }
		});
	}
}

/**
 * Changes a data type's name, description, column, action and word list. A new column puts it
 * at the end of that column (the panel's alternative to dragging).
 */
export async function saveDataType(
	organizationId: string,
	key: string,
	input: DataTypeInput & { tier: BoardTier; action: string }
): Promise<void> {
	const dt = await findDataType(organizationId, key);
	const { name, description, terms } = cleanInput(input);
	const column = columnFor(input.tier);
	const offered = column.actions as readonly string[];
	// A red `pseudonymize` shows as `block` (same effect); keep the stored value unless it changed.
	const unchanged = input.tier === dt.tier && input.action === shownAction(dt.tier, dt.action);
	const action = (unchanged ? dt.action : input.action) as Action;
	if (!unchanged && !offered.includes(action)) {
		throw new DraftError(`"${column.title}" doesn't offer that option.`);
	}
	await assertNameFree(organizationId, name, dt.id);
	// One transaction, so a failed save doesn't leave the move applied.
	await prisma.$transaction(async (tx) => {
		if (input.tier !== dt.tier) await placeInColumn(tx, organizationId, dt, input.tier, null);
		await tx.dataType.update({ where: { id: dt.id }, data: { name, description, action } });
		await saveTerms(tx, dt.id, terms);
	});
}

/** Adds a data type at the end of `tier`'s column, with that column's default action. */
export async function addDataType(
	organizationId: string,
	tier: BoardTier,
	input: DataTypeInput
): Promise<string> {
	const { name, description, terms } = cleanInput(input);
	await assertNameFree(organizationId, name);
	const existing = await prisma.dataType.findMany({
		where: { organizationId },
		select: { key: true, tier: true, position: true }
	});
	const key = keyFromName(
		name,
		existing.map((e) => e.key)
	);
	const action = columnFor(tier).actions[0]!;
	const contract = DataTypeContract.safeParse({ id: key, name, description, tier, action });
	if (!contract.success) throw new DraftError(contract.error.issues[0]!.message);
	const position =
		Math.max(-1, ...existing.filter((e) => e.tier === tier).map((e) => e.position)) + 1;
	await prisma.$transaction(async (tx) => {
		const created = await tx.dataType.create({
			data: { organizationId, key, name, description, examples: [], tier, action, position }
		});
		await saveTerms(tx, created.id, terms);
	});
	return key;
}

/** Deletes a data type. Built-in ones can't be deleted (`isBuiltin`). */
export async function deleteDataType(organizationId: string, key: string): Promise<void> {
	if (isBuiltin(key)) {
		throw new DraftError(
			"Built-in data types can't be deleted. Move them to another column instead."
		);
	}
	const dt = await findDataType(organizationId, key);
	await prisma.dataType.delete({ where: { id: dt.id } });
}

export async function setFailMode(organizationId: string, value: string): Promise<void> {
	const failMode = FailMode.safeParse(value);
	if (!failMode.success) throw new DraftError('Choose block or allow.');
	await prisma.organization.update({
		where: { id: organizationId },
		data: { failMode: failMode.data }
	});
}

/** Replaces the swap-back tool list, checked with the contract's `SwapBack` (issue #83). */
export async function setSwapBackTools(organizationId: string, tools: string[]): Promise<void> {
	const cleaned = [...new Set(tools.map((t) => t.trim()).filter(Boolean))];
	const parsed = SwapBack.safeParse({ tools: cleaned });
	if (!parsed.success) {
		const issue = parsed.error.issues[0]!;
		throw new DraftError(
			issue.code === 'invalid_format'
				? 'Use a tool name, or a name ending in * for every tool that starts with it (e.g. mcp__slack__*).'
				: issue.message
		);
	}
	await prisma.organization.update({
		where: { id: organizationId },
		data: { swapBackTools: parsed.data.tools }
	});
}

/** Publishes the draft as the next version. Agents pick it up on their next sync (≤ 30 s). */
export async function publish(organizationId: string, memberId: string): Promise<number> {
	const draft = await loadDraft(organizationId);
	// The button is disabled then too; this stops a direct request making a duplicate version.
	if (!(await draftStatus(organizationId, draft)).changed) {
		throw new DraftError('Nothing has changed since the last publish.');
	}
	try {
		return await prisma.$transaction(async (tx) => {
			const latest = await tx.policyVersion.findFirst({
				where: { organizationId },
				orderBy: { version: 'desc' },
				select: { version: true }
			});
			const version = (latest?.version ?? 0) + 1;
			const policy = policyFromDraft(draft, version, new Date());
			await tx.policyVersion.create({
				data: {
					organizationId,
					version,
					failMode: policy.failMode,
					snapshot: policy,
					publishedById: memberId
				}
			});
			return version;
		});
	} catch (e) {
		if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
			throw new DraftError('Someone else published at the same time. Reload and check the policy.');
		}
		throw e;
	}
}

/** Puts the draft back to the latest published version. */
export async function discardDraft(organizationId: string): Promise<void> {
	const policy = await latestPolicy(organizationId);
	if (!policy)
		throw new DraftError('Nothing has been published yet, so there is nothing to go back to.');
	const terms = new Map(policy.lists.map((l) => [l.dataTypeId, l.terms]));
	const positions: Partial<Record<Tier, number>> = {};
	await prisma.$transaction(async (tx) => {
		await tx.dataType.deleteMany({ where: { organizationId } });
		// The board no longer offers green types (policy-board.ts); an older version's are dropped.
		for (const dt of policy.dataTypes.filter((d) => d.tier !== 'green')) {
			const position = (positions[dt.tier] = (positions[dt.tier] ?? -1) + 1);
			const created = await tx.dataType.create({
				data: {
					organizationId,
					key: dt.id,
					name: dt.name,
					description: dt.description,
					examples: dt.examples,
					tier: dt.tier,
					action: dt.action,
					position
				}
			});
			await saveTerms(tx, created.id, terms.get(dt.id) ?? []);
		}
		await tx.organization.update({
			where: { id: organizationId },
			data: { failMode: policy.failMode, swapBackTools: policy.swapBack.tools }
		});
	});
}
