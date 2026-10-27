import { mergeSpans, type Span } from '@safecontext/detectors';
import type { DataType, Policy } from '@safecontext/policy';
import { stopsPromptsAndToolCalls, summarize } from '../../decide.ts';
import type { Tier1Config } from '../../config.ts';
import type { Logger } from '../../log.ts';
import type { ClassifierTier, ClassifyState } from '../types.ts';
import { loadGliner, type Encoded, type TaggerModel } from './gliner.ts';
import { decode, splitWords, windows } from './words.ts';

export interface Tier1Options {
	/** The span model, or a promise of it while it loads. A rejected promise makes tier 1 fail. */
	model: TaggerModel | Promise<TaggerModel>;
	/** Lowest model score that counts as a match, 0..1. Default 0.5 (gliner's default). */
	threshold?: number;
	/**
	 * The label text the model sees for a data type, unless the model's `labels.json` has one.
	 * Default: its name (`labelTemplate('{name}')`).
	 */
	label?: (dataType: DataType) => string;
}

export interface Tier1 extends ClassifierTier {
	/** Frees the model (onnxruntime session). Call on shutdown. */
	close(): Promise<void>;
}

/** Below this, a window can't finish in time, so the classifier times out straight away. */
const MIN_BUDGET_MS = 50;
/** A label prompt this close to the model's token limit leaves no room for text. */
const MIN_TEXT_TOKENS = 32;

/**
 * Builds a data type's label from a template with `{name}` and `{description}` placeholders,
 * e.g. `{name}` (the default) or `{name}: {description}` for a model trained with descriptions.
 */
export function labelTemplate(template: string): (dataType: DataType) => string {
	return (dt) => template.replaceAll('{name}', dt.name).replaceAll('{description}', dt.description).trim();
}

interface Labels {
	dataTypeIds: string[];
	promptIds: number[];
}

/**
 * Tier 1 (SPEC.md §4): a GLiNER label tagger for the admin's own data types. The labels are
 * the policy's data types, except those whose action is `allow` (tagging them can't change the
 * result, and a green label winning an overlap could hide a red one).
 *
 * Runs only when tier 0 isn't conclusive (see `shouldRun`). Long texts are cut into windows
 * the model can take; it checks the abort signal between windows, and windows from concurrent
 * checks take turns on the model rather than all running at once.
 */
export function createTier1({ model, threshold = 0.5, label = labelTemplate('{name}') }: Tier1Options): Tier1 {
	const ready = Promise.resolve(model);
	ready.catch(() => {}); // reported by the caller; each check then fails (fail mode applies)

	const labelCache = new WeakMap<Policy, Labels>();
	const labelsFor = (policy: Policy, m: TaggerModel): Labels => {
		let labels = labelCache.get(policy);
		if (!labels) {
			const seen = new Set<string>();
			const encoded: Encoded[] = [];
			const dataTypeIds: string[] = [];
			for (const dt of policy.dataTypes) {
				const text = (m.labels?.[dt.id] ?? label(dt)).trim();
				if (dt.action === 'allow' || text === '' || seen.has(text)) continue;
				seen.add(text);
				encoded.push({ text, ids: m.tokenize(text) });
				dataTypeIds.push(dt.id);
			}
			labels = { dataTypeIds, promptIds: encoded.length ? m.promptIds(encoded) : [] };
			labelCache.set(policy, labels);
		}
		return labels;
	};

	let turn: Promise<unknown> = Promise.resolve();
	/** Run one window on the model after the windows queued before it. */
	const queued = <T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> => {
		const result = turn.then(() => {
			signal.throwIfAborted();
			return work();
		});
		turn = result.catch(() => {});
		return result;
	};

	return {
		id: 'tier1',
		tier: 1,
		minBudgetMs: MIN_BUDGET_MS,

		shouldRun: needsTier1,

		async detect(texts, { policy, signal }) {
			const m = await abortable(ready, signal);
			const { dataTypeIds, promptIds } = labelsFor(policy, m);
			if (dataTypeIds.length === 0) return texts.map(() => []);
			const maxTokens = m.maxTokens - 2 - promptIds.length; // [CLS] and [SEP]
			if (maxTokens < MIN_TEXT_TOKENS) throw new Error('tier 1 label prompt is too long for the model');

			const out: Span[][] = [];
			for (const text of texts) {
				const words = splitWords(text);
				const tokenCache = new Map<string, readonly number[]>();
				const encoded: Encoded[] = words.map(({ text: word }) => {
					let ids = tokenCache.get(word);
					if (!ids) {
						ids = m.tokenize(word).slice(0, maxTokens);
						tokenCache.set(word, ids);
					}
					return { text: word, ids };
				});
				const limits = { maxWords: m.maxWords, maxTokens, overlap: m.maxWidth };
				const spans: Span[] = [];
				for (const [a, b] of windows(
					encoded.map((e) => e.ids.length),
					limits
				)) {
					const logits = await queued(signal, () => m.score(promptIds, dataTypeIds.length, encoded.slice(a, b)));
					for (const s of decode(logits, words.slice(a, b), dataTypeIds.length, m.maxWidth, threshold)) {
						spans.push({
							start: s.start,
							end: s.end,
							dataTypeId: dataTypeIds[s.label]!,
							source: 'tagger',
							confidence: s.score
						});
					}
				}
				out.push(spans.length > 1 ? mergeSpans(spans) : spans);
			}
			return out;
		},

		close: async () => {
			const m = await ready.catch(() => undefined);
			await m?.close();
		}
	};
}

/** Tier 1 as configured (`SC_TIER1_*`), or undefined when it's off. The model loads in the background. */
export function tier1FromConfig(config: Tier1Config | undefined, logger: Logger): Tier1 | undefined {
	if (!config) {
		logger.log('info', 'tier1_off');
		return undefined;
	}
	const start = performance.now();
	const model = loadGliner(config.modelDir, { modelFile: config.modelFile, threads: config.threads });
	model.then(
		() => logger.log('info', 'tier1_ready', { totalMs: Math.round(performance.now() - start) }),
		() => logger.log('error', 'tier1_failed')
	);
	return createTier1({ model, threshold: config.threshold, label: labelTemplate(config.labelTemplate) });
}

/**
 * Is tier 0 not conclusive, so tier 1 could still change the result? It is conclusive when:
 * - there is nothing for tier 1 to look at (no text, or no data type it tags), or
 * - for a prompt or tool input, tier 0 already found data that stops it: the outcome is a
 *   block either way. (The block message's safe version may then miss tier 1 data, but if the
 *   user sends it on, that new prompt is checked again, tier 1 included.)
 *
 * Tool output is never conclusive while there is text to tag: each flagged span is cleaned,
 * so tier 1 runs even when tier 0 found something.
 */
export function needsTier1({ policy, texts, spans, hook }: ClassifyState): boolean {
	if (!policy.dataTypes.some((dt) => dt.action !== 'allow')) return false;
	if (!texts.some((t) => /\S/.test(t))) return false;
	if (hook === 'UserPromptSubmit' || hook === 'PreToolUse') {
		return !summarize(spans.flat(), policy).some((hit) => hit.action !== 'allow' && stopsPromptsAndToolCalls(hit));
	}
	return true;
}

function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason as Error);
	return new Promise<T>((resolve, reject) => {
		const onAbort = () => reject(signal.reason as Error);
		signal.addEventListener('abort', onAbort, { once: true });
		work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
	});
}
