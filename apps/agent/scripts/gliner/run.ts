// Issue #5 spike runner: compares TS spans with the Python reference, then times ~300-token inputs.
//
//   pnpm --filter @safecontext/agent exec tsx scripts/gliner/run.ts [--runs 25] [--threads N] [--quantized]
//
// Needs ml/models/gliner_small-v2.1-onnx (export_onnx.py) and ml/spikes/gliner/reference_spans.json
// (reference_spans.py).
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Gliner, type Span } from "./gliner.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const modelDir = `${root}ml/models/gliner_small-v2.1-onnx`;
const spikeDir = `${root}ml/spikes/gliner`;

const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : fallback;
};
const runs = arg("runs", 25);
const threads = arg("threads", 0);
const modelFile = process.argv.includes("--quantized") ? "model_quantized.onnx" : "model.onnx";

const samples = JSON.parse(readFileSync(`${spikeDir}/samples.json`, "utf8")) as { labels: string[]; texts: string[] };
const ref = JSON.parse(readFileSync(`${spikeDir}/reference_spans.json`, "utf8")) as {
  threshold: number;
  token_counts: number[];
  torch: Span[][];
  onnx_python: Span[][];
};

const key = (s: Span) => `${s.start}:${s.end}:${s.label}`;

function compare(name: string, got: Span[][], want: Span[][]) {
  let tp = 0, fp = 0, fn = 0, maxDiff = 0;
  const diffs: string[] = [];
  got.forEach((g, i) => {
    const w = new Map(want[i]!.map((s) => [key(s), s]));
    const seen = new Set<string>();
    for (const s of g) {
      const m = w.get(key(s));
      if (m) {
        tp++;
        seen.add(key(s));
        maxDiff = Math.max(maxDiff, Math.abs(m.score - s.score));
      } else {
        fp++;
        diffs.push(`text ${i}: TS only ${key(s)} (${s.score.toFixed(4)})`);
      }
    }
    for (const [k, s] of w) {
      if (!seen.has(k)) {
        fn++;
        diffs.push(`text ${i}: ${name} only ${k} (${s.score.toFixed(4)})`);
      }
    }
  });
  const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  console.log(`vs ${name}: ref spans=${tp + fn}, ts spans=${tp + fp}, matched=${tp}, ts-only=${fp}, ref-only=${fn}, F1=${f1.toFixed(4)}, max |score diff|=${maxDiff.toExponential(2)}`);
  diffs.forEach((d) => console.log("  " + d));
}

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

const ortVersion = (createRequire(import.meta.url)("onnxruntime-node/package.json") as { version: string }).version;
const chip = (() => {
  try {
    return execSync("sysctl -n machdep.cpu.brand_string").toString().trim();
  } catch {
    return os.cpus()[0]?.model ?? "unknown";
  }
})();
console.log(`chip=${chip} cores=${os.cpus().length} node=${process.version} onnxruntime-node=${ortVersion} os=${os.type()} ${os.release()} threads=${threads || "default"} model=${modelFile}`);

const loadStart = performance.now();
const model = await Gliner.load(modelDir, threads ? { intraOpNumThreads: threads } : undefined, modelFile);
console.log(`model load: ${(performance.now() - loadStart).toFixed(0)}ms`);

// 1. Accuracy: same 20 texts, same labels, same threshold as the Python reference.
const got: Span[][] = [];
for (const t of samples.texts) got.push((await model.predict(t, samples.labels, ref.threshold)).spans);
compare("torch", got, ref.torch);
compare("onnx-python", got, ref.onnx_python);

// 2. Latency: texts of 250+ model tokens (the long samples), one text per call.
const long = samples.texts.map((t, i) => ({ t, tokens: ref.token_counts[i]! })).filter((x) => x.tokens >= 250);
console.log(`latency inputs: ${long.length} texts, ${Math.min(...long.map((x) => x.tokens))}-${Math.max(...long.map((x) => x.tokens))} text tokens`);
for (let i = 0; i < 5; i++) await model.predict(long[0]!.t, samples.labels);
const total: number[] = [];
const modelOnly: number[] = [];
let seq = 0;
for (let r = 0; r < runs; r++) {
  for (const { t } of long) {
    const t0 = performance.now();
    const res = await model.predict(t, samples.labels);
    total.push(performance.now() - t0);
    modelOnly.push(res.modelMs);
    seq = Math.max(seq, res.sequenceLength);
  }
}
const row = (name: string, xs: number[]) =>
  console.log(`${name}: n=${xs.length} p50=${pct(xs, 50).toFixed(1)}ms p95=${pct(xs, 95).toFixed(1)}ms max=${Math.max(...xs).toFixed(1)}ms`);
console.log(`max encoder sequence length (with ${samples.labels.length}-label prompt): ${seq}`);
row("end-to-end (split+tokenize+run+decode)", total);
row("onnx session.run only", modelOnly);
console.log(`rss=${(process.memoryUsage().rss / 1e6).toFixed(0)}MB`);
await model.close();
