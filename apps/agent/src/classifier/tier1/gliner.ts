/**
 * A GLiNER span model (uni-encoder, `markerV0` spans, e.g. urchade/gliner_small-v2.1) running on
 * onnxruntime-node. Reads a model directory as written by gliner's `export_to_onnx`
 * (`ml/spikes/gliner/export_onnx.py`): `model.onnx`, `tokenizer.json`, `tokenizer_config.json`
 * and `gliner_config.json`. Any export with the same inputs and outputs is a drop-in swap.
 *
 * Optional `labels.json` in the same directory: `{ "<data type id>": "<label text>" }`, the label
 * prompts the model was tuned or scored with (#13). Data types not in it use `SC_TIER1_LABEL`.
 *
 * onnxruntime-node and the tokenizer are imported lazily, so nothing native loads unless a
 * model is configured (and tests can use a fake `TaggerModel`).
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { InferenceSession } from 'onnxruntime-node';

/** A word or label and its subword token ids (no special tokens). */
export interface Encoded {
	text: string;
	ids: readonly number[];
}

/** What tier 1 needs from a span model. `loadGliner` is the real one; tests pass a fake. */
export interface TaggerModel {
	/** Longest span, in words (gliner_config `max_width`). */
	readonly maxWidth: number;
	/** Most words per call (gliner_config `max_len`). */
	readonly maxWords: number;
	/** Most tokens per call, including the label prompt and special tokens. */
	readonly maxTokens: number;
	/** Label text per data type id, from the model's `labels.json`. Overrides the label template. */
	readonly labels?: Readonly<Record<string, string>>;
	/** Subword ids for one word or label. */
	tokenize(text: string): number[];
	/** Token ids of the label prompt (`<<ENT>> label ... <<SEP>>`). */
	promptIds(labels: readonly Encoded[]): number[];
	/**
	 * Logits for every (start word, width, label), laid out `[word][width][label]`.
	 * `words` must fit `maxWords` and, with the prompt, `maxTokens`.
	 */
	score(promptIds: readonly number[], labelCount: number, words: readonly Encoded[]): Promise<Float32Array>;
	close(): Promise<void>;
}

export interface GlinerOptions {
	/** ONNX file inside the directory. Default `model.onnx`. */
	modelFile?: string;
	/** onnxruntime intra-op threads. 0 or unset: onnxruntime's default (all cores). */
	threads?: number;
}

interface GlinerConfig {
	max_width: number;
	max_len: number;
	ent_token: string;
	sep_token: string;
}

/** The DeBERTa-v3 encoder's position limit. */
const MAX_TOKENS = 512;

export async function loadGliner(
	dir: string,
	{ modelFile = 'model.onnx', threads = 0 }: GlinerOptions = {}
): Promise<TaggerModel> {
	const readJson = async (name: string): Promise<Record<string, unknown>> =>
		JSON.parse(await readFile(join(dir, name), 'utf8')) as Record<string, unknown>;
	const [tokenizerJson, tokenizerConfig, config, labels] = await Promise.all([
		readJson('tokenizer.json'),
		readJson('tokenizer_config.json'),
		readJson('gliner_config.json') as Promise<unknown> as Promise<GlinerConfig>,
		readLabels(join(dir, 'labels.json'))
	]);
	for (const key of ['max_width', 'max_len', 'ent_token', 'sep_token'] as const) {
		if (config[key] === undefined) throw new Error(`gliner_config.json has no ${key}`);
	}
	// Only now load the native runtime: a missing or broken model directory fails without it.
	const [ort, { Tokenizer }] = await Promise.all([import('onnxruntime-node'), import('@huggingface/tokenizers')]);
	const tokenizer = new Tokenizer(tokenizerJson, tokenizerConfig);
	const ids = (text: string) => tokenizer.encode(text, { add_special_tokens: false }).ids;
	const special = (token: string) => {
		const id = tokenizer.token_to_id(token);
		if (id === undefined) throw new Error(`tokenizer has no ${token} token`);
		return id;
	};
	const cls = special('[CLS]');
	const sep = special('[SEP]');
	const entIds = ids(config.ent_token);
	const sepIds = ids(config.sep_token);

	const sessionOptions: InferenceSession.SessionOptions = threads > 0 ? { intraOpNumThreads: threads } : {};
	const session = await ort.InferenceSession.create(join(dir, modelFile), sessionOptions);
	const maxWidth = config.max_width;

	return {
		maxWidth,
		maxWords: config.max_len,
		maxTokens: MAX_TOKENS,
		...(labels && { labels }),
		tokenize: ids,
		promptIds: (labels) => [...labels.flatMap((l) => [...entIds, ...l.ids]), ...sepIds],

		async score(promptIds, labelCount, words) {
			// [CLS] prompt words [SEP]; words_mask marks each word's first subword (1-based).
			const tokens: number[] = [cls, ...promptIds];
			const wordsMask: number[] = tokens.map(() => 0);
			words.forEach((w, i) => {
				w.ids.forEach((id, j) => {
					tokens.push(id);
					wordsMask.push(j === 0 ? i + 1 : 0);
				});
			});
			tokens.push(sep);
			wordsMask.push(0);

			const n = words.length;
			const spanIdx = new BigInt64Array(n * maxWidth * 2);
			const spanMask = new Uint8Array(n * maxWidth);
			for (let s = 0; s < n; s++) {
				for (let w = 0; w < maxWidth; w++) {
					const i = s * maxWidth + w;
					spanIdx[i * 2] = BigInt(s);
					spanIdx[i * 2 + 1] = BigInt(Math.min(s + w, n - 1));
					spanMask[i] = s + w < n ? 1 : 0;
				}
			}
			const int64 = (xs: readonly number[]) => BigInt64Array.from(xs, BigInt);
			const len = tokens.length;
			const out = await session.run({
				input_ids: new ort.Tensor('int64', int64(tokens), [1, len]),
				attention_mask: new ort.Tensor('int64', new BigInt64Array(len).fill(1n), [1, len]),
				words_mask: new ort.Tensor('int64', int64(wordsMask), [1, len]),
				text_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(n)), [1, 1]),
				span_idx: new ort.Tensor('int64', spanIdx, [1, n * maxWidth, 2]),
				span_mask: new ort.Tensor('bool', spanMask, [1, n * maxWidth])
			});
			const logits = out['logits'];
			if (!logits || logits.dims.at(-1) !== labelCount) throw new Error('unexpected GLiNER output');
			return logits.data as Float32Array;
		},

		close: () => session.release()
	};
}

/** `labels.json`, if there is one. */
async function readLabels(path: string): Promise<Record<string, string> | undefined> {
	let raw: string;
	try {
		raw = await readFile(path, 'utf8');
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw err;
	}
	const labels = JSON.parse(raw) as unknown;
	if (
		!labels ||
		typeof labels !== 'object' ||
		Array.isArray(labels) ||
		!Object.values(labels).every((v) => typeof v === 'string')
	) {
		throw new Error('labels.json must map data type ids to label strings');
	}
	return labels as Record<string, string>;
}
