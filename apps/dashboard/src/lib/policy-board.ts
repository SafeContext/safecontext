// The policy editor's board (issue #23): its columns, the choices each column offers, and the
// rules for moving and adding data types. Shared by the page and its server actions, so no
// server-only imports.
//
// The board shows only what Safe Context protects: "Make it vague" (yellow) and "Never share"
// (red). There is no "Safe to share" (green) column: nothing looks for a green data type (tier 1
// skips `allow` types), so a green pill would look like a setting and do nothing. To stop
// protecting something, delete its pill. The policy contract still accepts green types.
import type { Action, Tier } from '@safecontext/policy';
import { BUILTIN_DATA_TYPE } from '@safecontext/policy';

/** The tiers the board offers. */
export type BoardTier = Exclude<Tier, 'green'>;
export const BOARD_TIERS: readonly BoardTier[] = ['yellow', 'red'];
export const isBoardTier = (tier: string): tier is BoardTier =>
	(BOARD_TIERS as readonly string[]).includes(tier);

export type Column = {
	tier: BoardTier;
	title: string;
	/** What happens to this data, in a sentence (how the agent treats the tier: decide.ts). */
	summary: string;
	tone: 'vague' | 'never';
	/** Actions offered in this column, first is the default for a data type moved here. */
	actions: readonly Action[];
};

export const COLUMNS: readonly Column[] = [
	{
		tier: 'yellow',
		title: 'Make it vague',
		summary: 'Claude sees a placeholder instead, with a hint where one helps.',
		tone: 'vague',
		actions: ['pseudonymize', 'generalize', 'mask']
	},
	{
		tier: 'red',
		title: 'Never share',
		summary: 'Prompts and tool calls holding it are stopped; in files Claude reads, it is hidden.',
		tone: 'never',
		actions: ['block', 'mask']
	}
];

export const columnFor = (tier: BoardTier): Column => COLUMNS.find((c) => c.tier === tier)!;

/** How each action reads on the board, with an example of what Claude sees. */
export const ACTION_LABELS: Record<Action, { label: string; example: string }> = {
	allow: { label: 'Leave it', example: 'Northwind' },
	pseudonymize: { label: 'Placeholder only', example: '⟪customer_name_1⟫' },
	generalize: { label: 'Placeholder with a vague hint', example: '⟪revenue_figure_1: over $4M⟫' },
	mask: { label: 'Placeholder with a safe fragment', example: '⟪card_number_1: ****4242⟫' },
	block: { label: 'Placeholder only', example: '⟪secret_1⟫' }
};

/**
 * The action a data type gets in `tier`: its current one if that column offers it, else the
 * column's default. In "Never share", `pseudonymize` and `block` do the same thing (no hint, and
 * prompts are stopped either way), so a red `pseudonymize` keeps its value.
 */
export function actionFor(tier: BoardTier, current: Action): Action {
	const column = columnFor(tier);
	if (column.actions.includes(current)) return current;
	if (tier === 'red' && current === 'pseudonymize') return current;
	return column.actions[0]!;
}

/** The action as the board shows it (a red `pseudonymize` shows as "Placeholder only"). */
export function shownAction(tier: Tier, action: Action): Action {
	return tier === 'red' && action === 'pseudonymize' ? 'block' : action;
}

/**
 * Data types the agent's built-in rules report (API keys, emails, card numbers). They can move
 * between columns but not be deleted: the agent treats a data type missing from the policy as
 * "Never share", so deleting one wouldn't switch the rules off, only hide them from the board.
 */
export const BUILTIN_KEYS: readonly string[] = Object.values(BUILTIN_DATA_TYPE);

export const isBuiltin = (key: string) => BUILTIN_KEYS.includes(key);

/** Limits, matching the `DataType` contract in packages/policy and the database columns. */
export const LIMITS = {
	name: 80,
	description: 500,
	term: 200,
	terms: 5000
} as const;

/**
 * A policy id from a name: "Medical records" → "medical-records". Ids are kebab-case, at most 64
 * characters, and must start with a letter or digit. `taken` ids get "-2", "-3"… appended.
 */
export function keyFromName(name: string, taken: Iterable<string> = []): string {
	const base =
		name
			.normalize('NFKD')
			.replace(/[̀-ͯ]/g, '')
			.toLowerCase()
			.replace(/&/g, ' and ')
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 56)
			.replace(/-+$/, '') || 'data-type';
	const used = new Set(taken);
	if (!used.has(base)) return base;
	for (let n = 2; ; n++) {
		const key = `${base}-${n}`;
		if (!used.has(key)) return key;
	}
}

/**
 * Word list terms from what an admin typed: one per line (commas are part of a term, as in
 * "Acme, Inc."). Trimmed, blank lines and repeats (ignoring case) dropped, order kept.
 */
export function parseTerms(text: string): string[] {
	const seen = new Set<string>();
	const terms: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const term = line.trim();
		if (!term || seen.has(term.toLowerCase())) continue;
		seen.add(term.toLowerCase());
		terms.push(term);
	}
	return terms;
}

/** The first column of an uploaded CSV file, one term per line (for the word list box). */
export function csvFirstColumn(csv: string): string {
	return csv
		.split(/\r?\n/)
		.map((line) => firstCsvField(line).trim())
		.filter(Boolean)
		.join('\n');
}

/** The first field of a CSV line. A line with no comma or quote is returned whole. */
function firstCsvField(line: string): string {
	if (line.trimStart().startsWith('"')) {
		const s = line.trimStart();
		let out = '';
		for (let i = 1; i < s.length; i++) {
			if (s[i] === '"') {
				if (s[i + 1] === '"') {
					out += '"';
					i++;
				} else return out;
			} else out += s[i];
		}
		return out;
	}
	const comma = line.indexOf(',');
	return comma === -1 ? line : line.slice(0, comma);
}
