import { AGENT_DEFAULT_PORT } from '@safecontext/policy';

export interface AgentConfig {
	port: number;
	/** Local policy file (`SC_POLICY_FILE`). Unset: use `defaultPolicy()`. */
	policyFile: string | undefined;
	/**
	 * Time budget for checking one hook call, in ms (`SC_CHECK_BUDGET_MS`). When it runs out the
	 * policy's fail mode applies. Must stay well inside Claude Code's hook timeout (30 s for
	 * UserPromptSubmit) so the agent answers, rather than Claude Code timing out (SPEC.md §2a).
	 */
	checkBudgetMs: number;
}

/** Default check budget: room for tier 2 (~1–5 s) while staying far inside Claude Code's 30 s. */
export const DEFAULT_CHECK_BUDGET_MS = 8_000;
const MAX_CHECK_BUDGET_MS = 25_000;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
	return {
		port: int(env.SC_AGENT_PORT, AGENT_DEFAULT_PORT, 0, 65_535, 'SC_AGENT_PORT'),
		policyFile: env.SC_POLICY_FILE?.trim() || undefined,
		checkBudgetMs: int(env.SC_CHECK_BUDGET_MS, DEFAULT_CHECK_BUDGET_MS, 1, MAX_CHECK_BUDGET_MS, 'SC_CHECK_BUDGET_MS')
	};
}

function int(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
	if (raw === undefined || raw.trim() === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) {
		throw new Error(`${name} must be an integer from ${min} to ${max}`);
	}
	return n;
}
