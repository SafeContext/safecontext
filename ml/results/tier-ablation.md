# Are all three tiers needed? (25 Nov 2026)

Each tier switched off in turn, on the same code (main after #144), the default policy, an Apple
M3 Max. Two measurements:

- **Leak evaluation** (`apps/agent/scripts/leak-eval.ts`): 99 realistic Claude-written documents
  (`llm-test`, 624 sensitive items, 47 safe documents) and 205 template documents (849 items, 61
  safe). Full reports in `tier-ablation/`.
- **Usefulness benchmark** (`apps/agent/scripts/usefulness.ts`): 8 MacroHard tasks in real Claude
  Code on haiku, 3 runs each per setup. Report: `tier-ablation/usefulness-tiers.md`.

## Leak evaluation

| Tiers | Realistic: items caught | Realistic: safe docs changed | Templates: items caught | Templates: safe docs changed | Check time p50 / p95 (realistic) |
| --- | --- | --- | --- | --- | --- |
| 0 (rules, word lists) | 24.5% | 4/47 | 26.7% | 4/61 | 1 / 2 ms |
| 0 + 1 (tagger) | 94.7% | 12/47 | 97.9% | 10/61 | 187 / 333 ms |
| 0 + 1 + 2 (local LLM) | 94.7% | 12/47 | 97.9% | 6/61 | 784 / 3515 ms |

By data type (realistic set):

| Data type | Tier 0 | Tiers 0 + 1 | All three |
| --- | --- | --- | --- |
| Secrets | 98.3% | 100% | 100% |
| Customer personal data | 86.5% | 100% | 100% |
| Customer names | 0% | 99.1% | 99.1% |
| Unreleased roadmap | 0% | 89.4% | 89.4% |
| Revenue figures | 0% | 95.7% | 95.7% |
| Deal sizes | 0% | 91.7% | 91.7% |
| Internal metrics | 0% | 89.1% | 89.1% |

## Usefulness benchmark

| Tiers | Tasks done | Readable | Hidden values that reached Claude | Prompts blocked | Avg time |
| --- | --- | --- | --- | --- | --- |
| 0 | 100% | 100% | 49 | 0 | 10 s |
| 0 + 1 | 79% | 63% | 26 | 3 | 10 s |
| 0 + 1 + 2 | 79% | 50% | 28 | 3 | 15 s |

(With Safe Context off, #84 measured 127 values reaching Claude.)

## What it shows

- **Tier 0 is necessary and nearly free.** It is the only deterministic layer, it catches almost all
  secrets and most contact details on its own, in about a millisecond. But it knows nothing about
  the business: no customer names, roadmap, revenue, deals or metrics (0% each), so on its own
  three-quarters of what matters gets through.
- **Tier 1 does most of the work.** It takes catches from about 25% to 95%, and every business data
  type comes from it, for about 0.2 s a check. It is also where the cost to usefulness comes from:
  its false flags block the roadmap prompt (#145) and, before #148, file names, and the
  placeholders it adds make chat answers harder to read (#146).
- **Tier 2, as it stands, doesn't earn its place.** By design it can only take back tier 1's flags,
  so it adds no catches. It is supposed to cut false flags, but here it took back 4 of the 10
  wrongly changed safe template documents and none of the 12 realistic ones, and it did not unblock
  the roadmap prompt. In the benchmark the full setup was no better than tiers 0 + 1 (the small
  differences are within the noise of 3 runs). Its cost is real: about 0.6 s more per check at the
  median and about 3 s at p95 here, and about 7 GB of memory on each Mac.

## Caveats

- Both document sets are ours (generated in the MacroHard style); the benchmark is 3 runs per task.
- Tier 2's context judgement matters most for public-versus-internal cases (a codename in a press
  release). These sets have few of those, so they may undersell it.
- Without tier 2, names and dates lose their "vague" hints (numbers keep theirs: they use a fixed
  rule).

## Options

1. Keep tier 2, but fix what it's for: find out why it keeps the 12 wrongly changed realistic safe
   documents and the roadmap prompt (#145), and measure again.
2. Make tier 2 optional: off by default on each Mac, on when a company model server is available
   (#75), where the cost on the laptop goes away.
3. Replace tiers 1 and 2 with one larger model on a company server, and compare it in this harness.
