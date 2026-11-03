import { join } from 'node:path';
import { AGENT_DEFAULT_PORT } from '@safecontext/policy';
import { readSyncConfig, type SyncConfig } from './sync/config.ts';

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
	/** Dashboard sync (`SC_DASHBOARD_URL` and friends, see sync/config.ts). Unset: no sync. */
	sync: SyncConfig | undefined;
	/** Tier 1 tagger (issue #15). Undefined when `SC_TIER1_MODEL_DIR` is unset: tier 1 is off. */
	tier1: Tier1Config | undefined;
	/** Tier 2 small LLM (issue #16). Undefined unless `SC_TIER2_BASE_URL` or `SC_TIER2_MODEL` is set. */
	tier2: Tier2Config | undefined;
}

export interface Tier2Config {
	/**
	 * OpenAI-compatible API base (`SC_TIER2_BASE_URL`, default Ollama on this Mac). https, or http
	 * only on loopback: prompt and tool text must not cross a network in the clear (#75).
	 */
	baseUrl: string;
	/** Model name (`SC_TIER2_MODEL`, default the model pinned in `ml/models.lock.json`). */
	model: string;
	/** Optional key, sent as `Authorization: Bearer` (`SC_TIER2_API_KEY`). Never logged. */
	apiKey: string | undefined;
	/** Prompt files (`SC_TIER2_PROMPTS_DIR`, default the repo's `ml/prompts/tier2`). */
	promptsDir: string;
	/** Cap on one call (`SC_TIER2_TIMEOUT_MS`). Unset: `tier2.json` `timeouts.per_call_ms` (6 s). */
	timeoutMs: number | undefined;
}

/** Ollama's OpenAI-compatible API on this Mac. */
export const DEFAULT_TIER2_BASE_URL = 'http://127.0.0.1:11434/v1';
/** Chosen in #14; pinned with its digest in `ml/models.lock.json` (`external`, `tier2-llm`). */
export const PINNED_TIER2_MODEL = 'gemma4:e4b-it-q4_K_M';
export const PINNED_TIER2_DIGEST = 'sha256:dc35e8d9c6061baa6f0fa870975ab6932e2542b579b13ea0f199fa4bb7300c9c';
/** The prompt files the evaluation scored, in this repo. */
export const DEFAULT_TIER2_PROMPTS_DIR = join(import.meta.dirname, '../../../ml/prompts/tier2');

export interface Tier1Config {
	/** GLiNER ONNX export directory (`SC_TIER1_MODEL_DIR`). See classifier/tier1/gliner.ts. */
	modelDir: string;
	/** ONNX file in that directory (`SC_TIER1_MODEL_FILE`, default `model.onnx`). */
	modelFile: string;
	/**
	 * Lowest model score that counts as a match (`SC_TIER1_THRESHOLD`, 0..1). Unset: the
	 * model's `tier1.json` threshold, else 0.5.
	 */
	threshold: number | undefined;
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
		sync: readSyncConfig(env),
		tier1: readTier1Config(env),
		tier2: readTier2Config(env)
	};
}

function readTier2Config(env: NodeJS.ProcessEnv): Tier2Config | undefined {
	const rawUrl = env.SC_TIER2_BASE_URL?.trim();
	const model = env.SC_TIER2_MODEL?.trim();
	if (!rawUrl && !model) return undefined;
	const timeout = env.SC_TIER2_TIMEOUT_MS?.trim();
	return {
		baseUrl: tier2BaseUrl(rawUrl || DEFAULT_TIER2_BASE_URL),
		model: model || PINNED_TIER2_MODEL,
		apiKey: env.SC_TIER2_API_KEY?.trim() || undefined,
		promptsDir: env.SC_TIER2_PROMPTS_DIR?.trim() || DEFAULT_TIER2_PROMPTS_DIR,
		timeoutMs: timeout ? int(timeout, 0, 100, MAX_CHECK_BUDGET_MS, 'SC_TIER2_TIMEOUT_MS') : undefined
	};
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** https anywhere, http only on this Mac. No credentials, query or fragment in the URL. */
export function tier2BaseUrl(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error('SC_TIER2_BASE_URL must be a URL');
	}
	const ok = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname));
	if (!ok) throw new Error('SC_TIER2_BASE_URL must use https (http is only allowed for localhost)');
	if (url.username || url.password || url.search || url.hash) {
		throw new Error('SC_TIER2_BASE_URL must not contain credentials, a query or a fragment');
	}
	return url.origin + url.pathname.replace(/\/+$/, '');
}

function readTier1Config(env: NodeJS.ProcessEnv): Tier1Config | undefined {
	const modelDir = env.SC_TIER1_MODEL_DIR?.trim();
	if (!modelDir) return undefined;
	const threshold = env.SC_TIER1_THRESHOLD?.trim() ? Number(env.SC_TIER1_THRESHOLD) : undefined;
	if (threshold !== undefined && !(threshold > 0 && threshold < 1)) {
		throw new Error('SC_TIER1_THRESHOLD must be a number between 0 and 1');
	}
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
