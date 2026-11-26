# Are all three tiers needed? (25 Nov 2026)

Each tier switched off in turn, on the same code (main after #144), the default policy, an Apple
M3 Max. Two measurements:

- **Leak evaluation** (`apps/agent/scripts/leak-eval.ts`): 99 realistic Claude-written documents
  (`llm-test`, 624 sensitive items, 47 safe documents) and 205 template documents (849 items, 61
  safe). Full reports: `tier-ablation-leak-*.md`.
- **Usefulness benchmark** (`apps/agent/scripts/usefulness.ts`): 8 MacroHard tasks in real Claude
  Code on haiku, 3 runs each per setup. Report: `tier-ablation-usefulness-tiers.md`.

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

## Follow-up: why tier 2 cleared so little, and the fix (#152, 26 Nov 2026)

The leak report now lists what was hidden in each safe document. That showed the false flags
were mostly **outside tier 2's job**, not tier 2 failing at it:

- **Realistic set:** 11 of the 12 changed safe documents were changed only because a company role
  or example address (`support@example.com`, `press@example.com`, `developers@macrohard.io`) was
  hidden as customer personal data. Tier 0 already leaves those alone (#112), but tier 1 tagged
  them anyway, and tier 2 may not clear personal data.
- **Template set:** tier 2 cleared every flag it was allowed to judge (press-release dates and
  codenames, a public "30%"). What was left: placeholder keys (`AKIAXXXXXXXXXXXXXXXX`), fill-in
  addresses (`you@yourcompany.com`) and one codename tagged as a customer name.
- **Roadmap prompt (#145):** tier 2 did judge "2027 roadmap", and kept it: its prompt never said
  that naming a document isn't giving away what is in it.

Fixes: tier 1 drops email spans that tier 0's rule says are role, example or placeholder
addresses; `developers@` is a role address; secret rules skip keys with a run of 8 or more `X` or
`*`; and tier 2's prompt (version 2) adds one rule: a generic phrase for a document, topic or
kind of figure ("our 2027 roadmap") isn't sensitive, while a codename, product name, date, amount
or percentage never counts as one.

| Tiers | Realistic: items caught | Realistic: safe docs changed | Templates: items caught | Templates: safe docs changed | Check time p50 / p95 (realistic) |
| --- | --- | --- | --- | --- | --- |
| 0 + 1, before → after | 94.7% → 94.7% | 12/47 → **1/47** | 97.9% → 97.9% | 10/61 → **5/61** | 187 / 333 → 180 / 337 ms |
| 0 + 1 + 2, before → after | 94.7% → 94.7% | 12/47 → **1/47** | 97.9% → 97.9% | 6/61 → **1/61** | 784 / 3515 → 897 / 3781 ms |

The one realistic document left is a code file with `relay-alerts@macrohard.io` (a team address
whose name isn't only role words). With tiers 0 + 1 it also loses a "250" that tier 2 clears.
Reports: `tier-ablation-leak-*-after-152.md`.

**Roadmap prompt:** in real Claude Code (task P2, 3 runs each), tiers 0 + 1 + 2 now finish it 3 of
3 times; tiers 0 + 1 still block it 3 of 3 (`tier-ablation-usefulness-p2-after-152.md`). The runs
also showed a leak unrelated to tier 2: "Project Atlas" is hidden but a later plain "Atlas" is
not (#153).

**Tier 2's own scores** (`tier2-llm.md`): the new prompt gives the same results as the old one on
dev, test and llm-test: the same spans cleared, red recall unchanged. Two first
drafts of the rule did clear true spans (a codename used as a document title, a deal amount),
which the agent-level eval caught; the final wording doesn't.

**What it means for the options above:** on its own job, tier 2 works. It took the template set's
safe documents changed from 5 to 1, and it is the only thing that lets the roadmap prompt
through. Most of the false flags it "missed" belonged to tier 1 and tier 0 rules, now fixed. Its
cost (about 0.7 s more per check at the median, 7 GB of memory) is unchanged, so the
question of where it runs (each Mac or a company server, #75) still stands.

