"""Data type ids used as span labels.

Mirror of `DEFAULT_DATA_TYPES` in `packages/policy/src/defaults.ts` (the single source of truth).
`tests/test_labels.py` fails if the two drift apart. The defaults are still a proposal (issue #2,
SPEC.md §7.3), so expect this list to change; labels are always data type *ids*, never names.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Tier = Literal["green", "yellow", "red"]


@dataclass(frozen=True)
class DataType:
    id: str
    name: str
    tier: Tier
    description: str


DATA_TYPES: tuple[DataType, ...] = (
    DataType(
        "public-docs",
        "Public docs",
        "green",
        "Documentation, marketing pages and other material already published to the public.",
    ),
    DataType(
        "release-notes",
        "Release notes",
        "green",
        "Features and fixes that have already shipped and been announced.",
    ),
    DataType(
        "open-source-code",
        "Open-source code",
        "green",
        "Code from public open-source projects and libraries.",
    ),
    DataType(
        "revenue-figures",
        "Revenue figures",
        "yellow",
        "Non-public revenue, bookings, margins or growth numbers.",
    ),
    DataType(
        "internal-metrics",
        "Internal metrics",
        "yellow",
        "Non-public usage, adoption, churn or performance metrics.",
    ),
    DataType(
        "deal-sizes",
        "Deal sizes",
        "yellow",
        "Contract values, renewals and pricing agreed with specific customers.",
    ),
    DataType(
        "customer-names",
        "Customer names",
        "yellow",
        "Names of customer companies or organisations.",
    ),
    DataType(
        "unreleased-roadmap",
        "Unreleased roadmap",
        "red",
        "Plans, launch dates and codenames for products or features that are not public yet.",
    ),
    DataType(
        "secrets",
        "API keys & secrets",
        "red",
        "API keys, access tokens, private keys, passwords and connection strings.",
    ),
    DataType(
        "customer-personal-data",
        "Customer personal data",
        "red",
        "Personal details of customers or people: emails, phone numbers, card numbers, addresses.",
    ),
)

BY_ID: dict[str, DataType] = {d.id: d for d in DATA_TYPES}

#: Labels that appear on spans: every non-green data type. Green types ("allow") are never
#: span-labelled; green text is simply text with no spans.
SPAN_LABELS: tuple[str, ...] = tuple(d.id for d in DATA_TYPES if d.tier != "green")

RED_LABELS: tuple[str, ...] = tuple(d.id for d in DATA_TYPES if d.tier == "red")

# Short names used by the generators, so templates stay readable.
REVENUE = "revenue-figures"
METRICS = "internal-metrics"
DEAL = "deal-sizes"
CUSTOMER = "customer-names"
ROADMAP = "unreleased-roadmap"
SECRET = "secrets"
PERSONAL = "customer-personal-data"
