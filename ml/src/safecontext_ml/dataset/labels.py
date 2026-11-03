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
        "staff-names",
        "Staff names",
        "green",
        "Names, chat handles and work email addresses of colleagues: people who work for the "
        "organisation, not its customers.",
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

#: Data types that describe a whole document, not a value in it ("this is public docs"). They
#: never appear on spans: such text is simply text with no spans.
DOCUMENT_TYPES: tuple[str, ...] = ("public-docs", "release-notes", "open-source-code")

#: Labels that appear on spans: every data type except the document types. This is decided by
#: what the type *is*, not by its tier: `staff-names` is green by default but IT can move it to
#: yellow or red, so it is labelled like any other value (issue #78).
SPAN_LABELS: tuple[str, ...] = tuple(
    d.id for d in DATA_TYPES if d.id not in DOCUMENT_TYPES
)

RED_LABELS: tuple[str, ...] = tuple(d.id for d in DATA_TYPES if d.tier == "red")

#: Span labels that are sensitive under the default policy (yellow or red). Scores that ask
#: "was safe text flagged?" use these: a document whose only spans are staff names is safe by
#: default, and a staff-names prediction doesn't flag it.
SENSITIVE_LABELS: tuple[str, ...] = tuple(
    t for t in SPAN_LABELS if BY_ID[t].tier != "green"
)

# Short names used by the generators, so templates stay readable.
REVENUE = "revenue-figures"
METRICS = "internal-metrics"
DEAL = "deal-sizes"
CUSTOMER = "customer-names"
ROADMAP = "unreleased-roadmap"
SECRET = "secrets"
PERSONAL = "customer-personal-data"
STAFF = "staff-names"
