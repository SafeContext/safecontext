/** Opt-in diagnostic helpers. Not imported by the running agent or its health endpoint. */
import { AGENT_API, defaultPolicy } from '@safecontext/policy';
import type { Span } from '@safecontext/detectors';
import { createApp } from '../app.ts';
import { createClassifier } from '../classifier/classifier.ts';
import { createTier0, termListDetectors } from '../classifier/tier0.ts';
import { createTier1 } from '../classifier/tier1/tier1.ts';
import type { TaggerModel } from '../classifier/tier1/gliner.ts';
import type { ConfiguredTier2 } from '../classifier/tier2/tier2.ts';
import { DEFAULT_CHECK_BUDGET_MS, DEFAULT_TIER2_BASE_URL, PINNED_TIER2_MODEL } from '../config.ts';
import { memoryLogger } from '../log.ts';
import { staticPolicySource } from '../policy-source.ts';
import type { CheckReport } from '../events.ts';

export class InferenceCheckError extends Error {
	constructor(readonly reason: string) {
		super(reason);
	}
}

export interface InferencePins {
	revision: string;
	model: string;
	digest: string;
}

/** A demo child must not inherit company policy, sync credentials or model overrides. */
export function inferenceEnvironment(
	parent: NodeJS.ProcessEnv,
	modelDir: string,
	combined: boolean
): NodeJS.ProcessEnv {
	return {
		...Object.fromEntries(Object.entries(parent).filter(([k]) => !k.toUpperCase().startsWith('SC_'))),
		SC_AGENT_PORT: '4747',
		SC_TIER1_MODEL_DIR: modelDir,
		SC_TIER1_THREADS: '2',
		...(combined ? { SC_TIER2_BASE_URL: DEFAULT_TIER2_BASE_URL, SC_TIER2_MODEL: PINNED_TIER2_MODEL } : {})
	};
}

interface ExpectedSpan {
	start: number;
	end: number;
	dataTypeId: string;
}

interface Expected {
	spans: ExpectedSpan[];
	prompt: 'allow' | 'block';
	tool: 'unchanged' | 'rewritten';
}

export interface InferenceReference {
	schemaVersion: 1;
	revision: string;
	/** Human provenance; a fixture must be approved independently of this Windows run. */
	origin: string;
	cases: Array<{ text: string; tier1: Expected; combined?: Expected }>;
}

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Bound reference size/work, reject the old stock-model revision and invalid span offsets. */
export function parseReference(value: unknown, revision: string, combined = false): InferenceReference {
	const bad = () => {
		throw new InferenceCheckError('reference_invalid_or_wrong_revision');
	};
	if (
		!record(value) ||
		value.schemaVersion !== 1 ||
		value.revision !== revision ||
		typeof value.origin !== 'string' ||
		!value.origin.trim() ||
		value.origin.length > 300 ||
		!Array.isArray(value.cases) ||
		value.cases.length < 2 ||
		value.cases.length > 4
	)
		return bad();
	const types = new Set(defaultPolicy().dataTypes.map((d) => d.id));
	for (const sample of value.cases) {
		if (!record(sample) || typeof sample.text !== 'string' || !sample.text.trim() || sample.text.length > 4096)
			return bad();
		for (const expected of combined ? [sample.tier1, sample.combined] : [sample.tier1]) {
			if (
				!record(expected) ||
				!['allow', 'block'].includes(String(expected.prompt)) ||
				!['unchanged', 'rewritten'].includes(String(expected.tool)) ||
				!Array.isArray(expected.spans) ||
				expected.spans.length > 32
			)
				return bad();
			for (const s of expected.spans) {
				if (
					!record(s) ||
					!Number.isSafeInteger(s.start) ||
					!Number.isSafeInteger(s.end) ||
					(s.start as number) < 0 ||
					(s.end as number) <= (s.start as number) ||
					(s.end as number) > sample.text.length ||
					typeof s.dataTypeId !== 'string' ||
					!types.has(s.dataTypeId)
				)
					return bad();
			}
		}
	}
	const reference = value as unknown as InferenceReference;
	if (
		!reference.cases.some((c) => c.tier1.spans.length) ||
		!reference.cases.some((c) => c.tier1.prompt === 'allow') ||
		!reference.cases.some((c) => c.tier1.prompt === 'block')
	)
		return bad();
	return reference;
}

/** Ollama returns bare hex; lock files use sha256:<hex>. No prefix duplication or weak match. */
export function verifyOllamaPin(models: Array<{ name: string; digest: string }>, pins: InferencePins): void {
	const found = models.filter((m) => m.name === pins.model);
	if (found.length !== 1) throw new InferenceCheckError('ollama_model_missing_or_ambiguous');
	const digest = found[0]!.digest.replace(/^sha256:/, '');
	if (!/^[0-9a-f]{64}$/.test(digest) || `sha256:${digest}` !== pins.digest)
		throw new InferenceCheckError('ollama_digest_mismatch');
}

export function timings(ms: number[]) {
	if (!ms.length || ms.some((n) => !Number.isFinite(n) || n < 0)) throw new InferenceCheckError('timings_invalid');
	const sorted = [...ms].sort((a, b) => a - b);
	return {
		n: ms.length,
		p50Ms: sorted[Math.ceil(ms.length * 0.5) - 1]!,
		p95Ms: sorted[Math.ceil(ms.length * 0.95) - 1]!
	};
}

function spansMatch(actual: Span[], expected: ExpectedSpan[]) {
	const key = (s: ExpectedSpan) => `${s.start}:${s.end}:${s.dataTypeId}`;
	return JSON.stringify(actual.map(key).sort()) === JSON.stringify(expected.map(key).sort());
}

export interface InferenceDependencies {
	verifyFiles(): Promise<boolean>;
	loadModel(): Promise<TaggerModel>;
	listModels(): Promise<Array<{ name: string; digest: string }>>;
	startTier2(logger: ReturnType<typeof memoryLogger>): ConfiguredTier2;
	availableMemory(): number;
	now?: () => number;
}

/** Fixed fictional corpus: loading/timing evidence only, never a generated expected baseline. */
export async function smokeTier1(deps: Pick<InferenceDependencies, 'verifyFiles' | 'loadModel' | 'availableMemory'>) {
	if (!(await deps.verifyFiles())) throw new InferenceCheckError('tier1_files_not_verified');
	if (deps.availableMemory() < 3 * 2 ** 30) throw new InferenceCheckError('insufficient_available_memory');
	const start = performance.now();
	let model: TaggerModel;
	try {
		model = await deps.loadModel();
	} catch {
		throw new InferenceCheckError('tier1_load_failed');
	}
	const loadMs = performance.now() - start;
	try {
		const texts = [
			'This fictional public installation guide explains how to open a project.',
			'Fictional internal plan: Project Heron launches next month. Keep this roadmap private.'
		];
		const policy = defaultPolicy(new Date('2026-01-01T00:00:00Z'));
		const classifier = createClassifier({
			tiers: [createTier0(), createTier1({ model })],
			budgetMs: DEFAULT_CHECK_BUDGET_MS
		});
		const ms: number[] = [];
		let firstCallMs = 0;
		for (let i = 0; i < 23; i++) {
			const result = await classifier.classify([texts[i % texts.length]!], policy, { hook: 'PostToolUse' });
			if (!result.ok || !result.tiers.some((t) => t.id === 'tier1')) throw new InferenceCheckError('benchmark_failed');
			if (i === 0) firstCallMs = result.ms;
			if (i >= 3) ms.push(result.ms);
		}
		return {
			stage: 'smoke-tier1',
			modelLoadAndCalls: 'executed',
			predictionCorrectness: 'unverified_no_matching_reference',
			loadMs,
			firstCallMs,
			warm: timings(ms),
			warmupCalls: 2,
			measuredCalls: 20,
			rssBytes: process.memoryUsage().rss,
			policyBudgetMs: DEFAULT_CHECK_BUDGET_MS,
			note: 'Short fictional corpus; not comparable with the SPEC ~300-token latency target.'
		};
	} finally {
		await model.close();
	}
}

/** Reuses the real classifier, endpoint contracts and fail-mode semantics; no cloud/CLI calls. */
export async function checkInference(
	stage: 'tier1' | 'combined',
	reference: InferenceReference,
	pins: InferencePins,
	deps: InferenceDependencies
) {
	parseReference(reference, pins.revision, stage === 'combined');
	if (!(await deps.verifyFiles())) throw new InferenceCheckError('tier1_files_not_verified');
	// Diagnostic resource guard only, never a change to the product's fail mode or deadlines.
	if (deps.availableMemory() < (stage === 'combined' ? 10 : 3) * 2 ** 30)
		throw new InferenceCheckError('insufficient_available_memory');
	if (stage === 'combined') verifyOllamaPin(await deps.listModels(), pins);
	const now = deps.now ?? (() => performance.now());
	const logger = memoryLogger();
	const events: CheckReport[] = [];
	const policy = defaultPolicy(new Date('2026-01-01T00:00:00Z'));
	const loadedAt = now();
	let model: TaggerModel;
	try {
		model = await deps.loadModel();
	} catch {
		throw new InferenceCheckError('tier1_load_failed');
	}
	const loadMs = now() - loadedAt;
	try {
		const tier1 = createTier1({ model });
		// Validate the matching model's expected spans separately from context-based clearing.
		const first = now();
		for (const sample of reference.cases) {
			const spans = await tier1.detect([sample.text], {
				policy,
				signal: AbortSignal.timeout(DEFAULT_CHECK_BUDGET_MS),
				remainingMs: DEFAULT_CHECK_BUDGET_MS
			});
			if (!spansMatch(spans[0]!, sample.tier1.spans)) throw new InferenceCheckError('tier1_reference_mismatch');
		}
		const firstPassMs = now() - first;
		let tier2: ConfiguredTier2 | undefined;
		if (stage === 'combined') {
			tier2 = deps.startTier2(logger);
			await tier2.ready;
			if (
				!logger.records.some((r) => r.msg === 'tier2_ready') ||
				logger.records.some((r) => r.msg === 'tier2_unavailable')
			)
				throw new InferenceCheckError('tier2_not_ready');
		}
		const classifier = createClassifier({
			tiers: [createTier0({ policyDetectors: termListDetectors }), tier1, ...(tier2 ? [tier2.tier] : [])],
			budgetMs: DEFAULT_CHECK_BUDGET_MS
		});
		const app = createApp({
			policy: staticPolicySource(policy),
			classifier,
			logger,
			events: { record: (e) => events.push(e) },
			generalizer: tier2?.generalizer
		});
		let tier2Ran = false;
		for (const sample of reference.cases) {
			const expected = stage === 'combined' ? sample.combined! : sample.tier1;
			const result = await classifier.classify([sample.text], policy, { hook: 'PostToolUse' });
			if (!result.ok || !result.tiers.some((t) => t.id === 'tier1') || !spansMatch(result.spans[0]!, expected.spans))
				throw new InferenceCheckError('classifier_reference_mismatch');
			tier2Ran ||= result.tiers.some((t) => t.id === 'tier2');
			const common = { session_id: 'windows-inference-synthetic', cwd: 'C:/synthetic-project' };
			const prompt = await app.request(AGENT_API.prompt.path, {
				method: 'POST',
				body: JSON.stringify({ ...common, hook_event_name: 'UserPromptSubmit', prompt: sample.text })
			});
			const promptOut = AGENT_API.prompt.response.parse(await prompt.json());
			if (prompt.status !== 200 || (promptOut.decision === 'block' ? 'block' : 'allow') !== expected.prompt)
				throw new InferenceCheckError('prompt_reference_mismatch');
			const tool = await app.request(AGENT_API.toolOutput.path, {
				method: 'POST',
				body: JSON.stringify({
					...common,
					hook_event_name: 'PostToolUse',
					tool_name: 'Bash',
					tool_input: {},
					tool_use_id: 'synthetic',
					tool_response: { stdout: sample.text, stderr: '' }
				})
			});
			const toolOut = AGENT_API.toolOutput.response.parse(await tool.json());
			const updated = toolOut.hookSpecificOutput?.updatedToolOutput as { stdout?: unknown } | undefined;
			if (
				tool.status !== 200 ||
				(typeof updated?.stdout === 'string' && updated.stdout !== sample.text ? 'rewritten' : 'unchanged') !==
					expected.tool
			)
				throw new InferenceCheckError('tool_reference_mismatch');
		}
		if (stage === 'combined' && !tier2Ran) throw new InferenceCheckError('tier2_did_not_run');
		// Fixed sequential corpus: two warm-up calls followed by twenty timed checks.
		const ms: number[] = [];
		for (let n = 0; n < 22; n++) {
			const sample = reference.cases[n % reference.cases.length]!;
			const expected = stage === 'combined' ? sample.combined! : sample.tier1;
			const result = await classifier.classify([sample.text], policy, { hook: 'PostToolUse' });
			if (!result.ok || !result.tiers.some((t) => t.id === 'tier1') || !spansMatch(result.spans[0]!, expected.spans))
				throw new InferenceCheckError('benchmark_failed');
			if (n >= 2) ms.push(result.ms);
		}
		if (logger.records.some((r) => r.msg === 'tier2_call_failed')) throw new InferenceCheckError('tier2_call_failed');
		const metadata = JSON.stringify({ logs: logger.records, events });
		if (reference.cases.some((c) => metadata.includes(c.text)))
			throw new InferenceCheckError('diagnostic_privacy_failure');
		if (stage === 'combined') verifyOllamaPin(await deps.listModels(), pins);
		return {
			stage,
			functional: 'passed' as const,
			liveModelEvidence: true,
			loadMs,
			firstPassMs,
			warm: timings(ms),
			tier2Ran,
			referenceCases: reference.cases.length,
			rssBytes: process.memoryUsage().rss,
			policyBudgetMs: DEFAULT_CHECK_BUDGET_MS,
			tier1ComparisonTargetMs: 300,
			note: 'Synthetic reference compatibility only; not accuracy or complete hook coverage.'
		};
	} finally {
		await model.close();
	}
}
