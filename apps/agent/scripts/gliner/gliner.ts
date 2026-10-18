// Spike for issue #5: GLiNER (span model) on onnxruntime-node. Not production code.
//
// Mirrors the Python `gliner` package (0.2.29) for urchade/gliner_small-v2.1:
//   words -> prompt "<<ENT>> label ... <<SEP>> word word ..." -> subword ids -> ONNX -> sigmoid -> greedy flat NER.
// No maintained JS GLiNER package was used; see the write-up on issue #5.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Tokenizer } from "@huggingface/tokenizers";
import * as ort from "onnxruntime-node";

export interface Span {
  start: number;
  end: number;
  label: string;
  score: number;
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

interface GlinerConfig {
  max_width: number;
  max_len: number;
  ent_token: string;
  sep_token: string;
}

const CLS_ID = 1;
const SEP_ID = 2;

/** Same split as Python's WhitespaceTokenSplitter: `\w+(?:[-_]\w+)*|\S`. */
export function splitWords(text: string): Word[] {
  const pattern = /[\p{L}\p{M}\p{N}_]+(?:[-_][\p{L}\p{M}\p{N}_]+)*|\S/gu;
  return [...text.matchAll(pattern)].map((m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function overlaps(a: Span, b: Span, aw: [number, number], bw: [number, number]): boolean {
  if (aw[0] === bw[0] && aw[1] === bw[1]) return true; // same word range, single-label mode
  return !(aw[0] > bw[1] || bw[0] > aw[1]);
}

interface Candidate extends Span {
  words: [number, number];
}

/**
 * Turns the model's raw logits [1, numWords, maxWidth, numLabels] into spans.
 * Greedy flat NER: highest score first, drop anything overlapping a kept span.
 */
export function decode(
  logits: ArrayLike<number>,
  words: Word[],
  labels: string[],
  maxWidth: number,
  threshold: number,
): Span[] {
  const n = words.length;
  const c = labels.length;
  const found: Candidate[] = [];
  for (let s = 0; s < n; s++) {
    for (let w = 0; w < maxWidth; w++) {
      const e = s + w;
      if (e >= n) break; // padded span, masked in the model
      const base = (s * maxWidth + w) * c;
      for (let k = 0; k < c; k++) {
        const score = sigmoid(logits[base + k] as number);
        if (score >= threshold) {
          found.push({
            start: words[s]!.start,
            end: words[e]!.end,
            label: labels[k]!,
            score,
            words: [s, e],
          });
        }
      }
    }
  }
  const kept: Candidate[] = [];
  for (const cand of [...found].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => overlaps(cand, k, cand.words, k.words))) kept.push(cand);
  }
  return kept
    .sort((a, b) => a.start - b.start || a.end - b.end || a.label.localeCompare(b.label))
    .map(({ start, end, label, score }) => ({ start, end, label, score }));
}

export class Gliner {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tokenizer: Tokenizer,
    private readonly config: GlinerConfig,
  ) {}

  /** `dir` is the output of ml/spikes/gliner/export_onnx.py. */
  static async load(
    dir: string,
    options?: ort.InferenceSession.SessionOptions,
    modelFile = "model.onnx",
  ): Promise<Gliner> {
    const readJson = (name: string): object => JSON.parse(readFileSync(join(dir, name), "utf8"));
    const tokenizer = new Tokenizer(readJson("tokenizer.json"), readJson("tokenizer_config.json"));
    const config = readJson("gliner_config.json") as GlinerConfig;
    const session = await ort.InferenceSession.create(join(dir, modelFile), options);
    return new Gliner(session, tokenizer, config);
  }

  /** Builds the six int64/bool tensors the exported graph takes (batch size 1). */
  private buildInputs(words: Word[], labels: string[]) {
    const { ent_token, sep_token, max_width } = this.config;
    const prompt = labels.flatMap((l) => [ent_token, l]).concat(sep_token);
    const ids: number[] = [CLS_ID];
    const wordsMask: number[] = [0];
    for (const w of prompt) {
      for (const id of this.tokenizer.encode(w, { add_special_tokens: false }).ids) {
        ids.push(id);
        wordsMask.push(0);
      }
    }
    words.forEach((w, i) => {
      this.tokenizer.encode(w.text, { add_special_tokens: false }).ids.forEach((id: number, j: number) => {
        ids.push(id);
        wordsMask.push(j === 0 ? i + 1 : 0);
      });
    });
    ids.push(SEP_ID);
    wordsMask.push(0);

    const n = words.length;
    const spanIdx: bigint[] = [];
    const spanMask: boolean[] = [];
    for (let s = 0; s < n; s++) {
      for (let w = 0; w < max_width; w++) {
        spanIdx.push(BigInt(s), BigInt(Math.min(s + w, n - 1)));
        spanMask.push(s + w < n);
      }
    }
    const big = (xs: number[]) => BigInt64Array.from(xs, BigInt);
    const len = ids.length;
    return {
      feeds: {
        input_ids: new ort.Tensor("int64", big(ids), [1, len]),
        attention_mask: new ort.Tensor("int64", big(ids.map(() => 1)), [1, len]),
        words_mask: new ort.Tensor("int64", big(wordsMask), [1, len]),
        text_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(n)]), [1, 1]),
        span_idx: new ort.Tensor("int64", BigInt64Array.from(spanIdx), [1, n * max_width, 2]),
        span_mask: new ort.Tensor("bool", Uint8Array.from(spanMask, Number), [1, n * max_width]),
      },
      sequenceLength: len,
    };
  }

  async close(): Promise<void> {
    await this.session.release();
  }

  async predict(
    text: string,
    labels: string[],
    threshold = 0.5,
  ): Promise<{ spans: Span[]; sequenceLength: number; modelMs: number }> {
    const words = splitWords(text).slice(0, this.config.max_len);
    if (words.length === 0) return { spans: [], sequenceLength: 0, modelMs: 0 };
    const { feeds, sequenceLength } = this.buildInputs(words, labels);
    const t0 = performance.now();
    const out = await this.session.run(feeds);
    const modelMs = performance.now() - t0;
    const logits = out["logits"]!.data as Float32Array;
    return { spans: decode(logits, words, labels, this.config.max_width, threshold), sequenceLength, modelMs };
  }
}
