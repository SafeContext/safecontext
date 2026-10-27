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
	/** Tier 1 tagger (issue #15). Undefined when `SC_TIER1_MODEL_DIR` is unset: tier 1 is off. */
	tier1: Tier1Config | undefined;
}

export interface Tier1Config {
	/** GLiNER ONNX export directory (`SC_TIER1_MODEL_DIR`). See classifier/tier1/gliner.ts. */
	modelDir: string;
	/** ONNX file in that directory (`SC_TIER1_MODEL_FILE`, default `model.onnx`). */
	modelFile: string;
	/** Lowest model score that counts as a match (`SC_TIER1_THRESHOLD`, 0..1, default 0.5). */
	threshold: number;
	/** onnxruntime intra-op threads (`SC_TIER1_THREADS`, default 0: all cores). */
	threads: number;
	/**
	 * The label the model sees for each data type (`SC_TIER1_LABEL`, default `{name}`).
	 * Placeholders: `{name}`, `{description}`.
	 */
	labelTemplate: string;
}

/** Default check budget: room for tier 2 (~1–5 s) while staying far inside Claude Code's 30 s. */
export const DEFAULT_CHECK_BUDGET_MS = 8_000;
const MAX_CHECK_BUDGET_MS = 25_000;

export function readConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
	return {
		port: int(env.SC_AGENT_PORT, AGENT_DEFAULT_PORT, 0, 65_535, 'SC_AGENT_PORT'),
		policyFile: env.SC_POLICY_FILE?.trim() || undefined,
		checkBudgetMs: int(env.SC_CHECK_BUDGET_MS, DEFAULT_CHECK_BUDGET_MS, 1, MAX_CHECK_BUDGET_MS, 'SC_CHECK_BUDGET_MS'),
		tier1: readTier1Config(env)
	};
}

function readTier1Config(env: NodeJS.ProcessEnv): Tier1Config | undefined {
	const modelDir = env.SC_TIER1_MODEL_DIR?.trim();
	if (!modelDir) return undefined;
	const threshold = env.SC_TIER1_THRESHOLD?.trim() ? Number(env.SC_TIER1_THRESHOLD) : 0.5;
	if (!(threshold > 0 && threshold < 1)) throw new Error('SC_TIER1_THRESHOLD must be a number between 0 and 1');
	const labelTemplate = env.SC_TIER1_LABEL?.trim() || '{name}';
	if (!/\{(name|description)\}/.test(labelTemplate)) {
		throw new Error('SC_TIER1_LABEL must contain {name} or {description}');
	}
	return {
		modelDir,
		modelFile: env.SC_TIER1_MODEL_FILE?.trim() || 'model.onnx',
		threshold,
		threads: int(env.SC_TIER1_THREADS, 0, 0, 256, 'SC_TIER1_THREADS'),
		labelTemplate
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
