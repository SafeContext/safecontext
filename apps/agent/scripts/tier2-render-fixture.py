"""Writes the tier 2 prompt-rendering fixture the agent's tests compare against (issue #16).

The agent's TypeScript port (`src/classifier/tier2/prompts.ts`) must build exactly the chat
messages the Python reference (`ml/src/safecontext_ml/tier2/prompts.py`) builds. This renders a
few shared cases with the reference and saves them. Rerun after changing a prompt file:

    python3 apps/agent/scripts/tier2-render-fixture.py

(from the repo root; standard library only, no `uv sync` needed).
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ml" / "src"))

from safecontext_ml.tier2 import prompts as P  # noqa: E402

OUT = ROOT / "apps/agent/src/classifier/tier2/fixtures/render.json"

DATA_TYPES = {
    "unreleased-roadmap": P.DataTypeInfo(
        "unreleased-roadmap",
        "Unreleased roadmap",
        "Plans, launch dates and codenames for products or features that are not public yet.",
    ),
    "revenue-figures": P.DataTypeInfo(
        "revenue-figures", "Revenue figures", "Non-public revenue, bookings, margins or growth numbers."
    ),
    "deal-sizes": P.DataTypeInfo("deal-sizes", "Deal sizes", ""),
}


def at(text, needle, dt, nth=0):
    i = -1
    for _ in range(nth + 1):
        i = text.index(needle, i + 1)
    return {"start": i, "end": i + len(needle), "data_type": dt}


long_text = "a" * 2000 + " Heron ships in May. " + "b" * 3000 + " Quill is planned. " + "c" * 100
cases = [
    ("context", "Project Heron launches March 3.", [("Project Heron", "unreleased-roadmap"), ("March 3", "unreleased-roadmap")]),
    (
        "context",
        'Notes: {{spans}} and {{data_types}} stay literal.\n"Quill" ships\tnext week; revenue $4.2M.',
        [('"Quill" ships', "unreleased-roadmap"), ("$4.2M", "revenue-figures")],
    ),
    (
        "generalize",
        "Q3 revenue was $4.2M, up 18%. Pellham renewed at €865k 🚀 with Bluefin Logistics.",
        [("$4.2M", "revenue-figures"), ("€865k", "deal-sizes"), ("Bluefin Logistics", "customer-names")],
    ),
    ("context", long_text, [("Heron", "unreleased-roadmap"), ("Quill", "unreleased-roadmap")]),
]

out = []
for task, text, wanted in cases:
    spans = [at(text, needle, dt) for needle, dt in wanted]
    refs = [P.SpanRef(s["start"], s["end"], s["data_type"]) for s in spans]
    m = P.manifest()
    requests = []
    for ex in P.excerpts(text, refs, m["excerpts"]["context_chars"], m["excerpts"]["max_chars"]):
        req = P.build_request(task, ex.text, ex.spans, DATA_TYPES, ex.offset)
        requests.append({"ids": req.ids, "messages": req.messages})
    # The agent's offsets are UTF-16 code units (JavaScript strings), Python's are code points.
    u16 = lambda i: len(text[:i].encode("utf-16-le")) // 2  # noqa: E731
    spans16 = [{**s, "start": u16(s["start"]), "end": u16(s["end"])} for s in spans]
    out.append({"task": task, "text": text, "spans": spans16, "requests": requests})

fixture = {
    "about": "Written by apps/agent/scripts/tier2-render-fixture.py from the Python reference. Don't edit.",
    "data_types": {k: {"name": v.name, "description": v.description} for k, v in DATA_TYPES.items()},
    "cases": out,
}
OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(fixture, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"wrote {OUT.relative_to(ROOT)}: {len(out)} cases")
