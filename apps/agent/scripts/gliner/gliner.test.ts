import { describe, expect, it } from "vitest";
import { decode, splitWords } from "./gliner.ts";

describe("splitWords", () => {
  it("matches the Python splitter: hyphen/underscore words stay whole, punctuation splits", () => {
    const words = splitWords("Hi, build-07.corp (a_b) $4.2M");
    expect(words.map((w) => w.text)).toEqual(["Hi", ",", "build-07", ".", "corp", "(", "a_b", ")", "$", "4", ".", "2M"]);
  });

  it("keeps character offsets into the original text", () => {
    const text = "Ask Priya now";
    const [, w] = splitWords(text);
    expect(text.slice(w!.start, w!.end)).toBe("Priya");
  });
});

describe("decode", () => {
  // 3 words, maxWidth 2, 2 labels: logits laid out [word][width][label]
  const words = splitWords("Priya Raman left");
  const logits = new Float32Array(3 * 2 * 2).fill(-10);
  const at = (s: number, w: number, k: number) => (s * 2 + w) * 2 + k;

  it("keeps the highest-scoring of overlapping spans", () => {
    logits[at(0, 1, 0)] = 3; // "Priya Raman" as label 0
    logits[at(0, 0, 1)] = 1; // "Priya" as label 1 (overlaps, lower score)
    const spans = decode(logits, words, ["person", "org"], 2, 0.5);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ start: 0, end: 11, label: "person" });
  });

  it("ignores spans that run past the last word", () => {
    const l = new Float32Array(3 * 2 * 2).fill(-10);
    l[at(2, 1, 0)] = 9; // word 2 + width 1 = word 3, which does not exist
    expect(decode(l, words, ["person", "org"], 2, 0.5)).toEqual([]);
  });
});
