import * as z from 'zod';

/** Lowercase kebab-case id, e.g. "customer-names". Also used as event keys, so never free text. */
export const Id = z
	.string()
	.regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'must be lowercase kebab-case, max 64 chars');

/** The traffic-light column a data type sits in on the dashboard. */
export const Tier = z.enum(['green', 'yellow', 'red']);
export type Tier = z.infer<typeof Tier>;

/**
 * What the agent does to a span of this data type.
 * - allow: leave it.
 * - generalize: make it vague but true ("$4.2M, up 18%" -> "mid-teens growth"). Uses tier 2.
 * - pseudonymize: consistent placeholder per session ("Northwind" -> "customer_1").
 * - mask: keep a safe fragment ("4242 4242 4242 4242" -> "****4242").
 * - block: never let it through. Prompts are blocked; tool output has it removed.
 */
export const Action = z.enum(['allow', 'generalize', 'pseudonymize', 'mask', 'block']);
export type Action = z.infer<typeof Action>;

/** An admin-defined data type, e.g. "Customer names" or "Revenue figures". */
export const DataType = z.strictObject({
	id: Id,
	name: z.string().min(1).max(80),
	/** Plain-language description. Also fed to the tier 1 tagger as the label description. */
	description: z.string().max(500),
	examples: z.array(z.string().max(200)).max(20).default([]),
	tier: Tier,
	action: Action
});
export type DataType = z.infer<typeof DataType>;

/** Exact-match terms an admin uploads (codenames, customer names). Matched by tier 0. */
export const TermList = z.strictObject({
	dataTypeId: Id,
	terms: z.array(z.string().min(1).max(200))
});
export type TermList = z.infer<typeof TermList>;

/** What the agent does when it can't finish checking (error or time budget). See SPEC.md §2a. */
export const FailMode = z.enum(['block', 'allow']);
export type FailMode = z.infer<typeof FailMode>;

/**
 * A published policy. The dashboard creates a new `version` on every publish;
 * the agent keeps the highest version it has seen.
 */
export const Policy = z
	.strictObject({
		version: z.number().int().nonnegative(),
		updatedAt: z.iso.datetime(),
		dataTypes: z.array(DataType).min(1),
		lists: z.array(TermList).default([]),
		failMode: FailMode.default('block')
	})
	.superRefine((policy, ctx) => {
		const ids = new Set<string>();
		policy.dataTypes.forEach((dt, i) => {
			if (ids.has(dt.id)) {
				ctx.addIssue({ code: 'custom', path: ['dataTypes', i, 'id'], message: `duplicate data type id "${dt.id}"` });
			}
			ids.add(dt.id);
			if ((dt.tier === 'green') !== (dt.action === 'allow')) {
				ctx.addIssue({
					code: 'custom',
					path: ['dataTypes', i, 'action'],
					message: 'green data types must use "allow", and only green data types may use it'
				});
			}
		});
		policy.lists.forEach((list, i) => {
			if (!ids.has(list.dataTypeId)) {
				ctx.addIssue({ code: 'custom', path: ['lists', i, 'dataTypeId'], message: `unknown data type "${list.dataTypeId}"` });
			}
		});
	});
export type Policy = z.infer<typeof Policy>;
export type PolicyInput = z.input<typeof Policy>;

/** True if `next` should replace `current` (the agent only moves forward). */
export function isNewerPolicy(current: Pick<Policy, 'version'> | undefined, next: Pick<Policy, 'version'>): boolean {
	return current === undefined || next.version > current.version;
}
