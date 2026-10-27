"""Made-up values for the "Macrohard" universe, and the slot kinds templates can use.

Every name here is invented. Pools of names (customers, people, codenames) are partitioned by
split (see `split.partition`), so test entity strings never appear in train. Numbers, dates,
contact details and secrets are random and need no partitioning.

Secrets are random strings in realistic formats so tier 0 rules and the tagger learn the shapes.
They are generated at run time and never committed.
"""

from __future__ import annotations

import random
import string
from collections.abc import Callable
from dataclasses import dataclass
from functools import cache

from . import labels as L
from .split import Split, partition

COMPANY = "Macrohard"
COMPANY_DOMAIN = "macrohard.io"

# --- Pools ------------------------------------------------------------------------------------

CUSTOMER_STEMS = (
    "Bluefin", "Quarry", "Halden", "Corvid", "Tamsin", "Ostrander", "Brightwater", "Kestrel",
    "Marlow", "Pinecrest", "Redfern", "Silverline", "Thornbury", "Wexford", "Ashgrove", "Calder",
    "Driftwood", "Elmstead", "Fairhaven", "Glenmore", "Hollis", "Ironbridge", "Juniper",
    "Kingsley", "Larkspur", "Millbrook", "Northgate", "Oakhurst", "Pemberton", "Ravenna",
    "Stonebridge", "Tidewater", "Upland", "Vantage", "Westmoor", "Yarrow", "Zephyr", "Copperleaf",
    "Granite Peak", "Harbourside", "Lindqvist", "Morrow & Pike", "Okonkwo", "Saltmarsh",
    "Brannock", "Cardew", "Fenwick", "Galloway",
)  # fmt: skip
CUSTOMER_SUFFIXES = (
    "Logistics", "Health", "Bank", "Foods", "Retail", "Insurance", "Energy", "Labs", "Group",
    "Systems", "Partners", "Pharma", "Credit Union", "Airlines", "Media",
)  # fmt: skip

FIRST_NAMES = (
    "Amara", "Bertrand", "Chiara", "Dmitri", "Esther", "Farid", "Greta", "Hiroshi", "Ines",
    "Jonah", "Keziah", "Lorenzo", "Maeve", "Nikolai", "Odette", "Pradeep", "Quinn", "Rosalind",
    "Soren", "Tamara", "Ulrich", "Valentina", "Wendell", "Ximena", "Yusuf", "Zofia", "Abel",
    "Bronwyn", "Cormac", "Delphine", "Emeka", "Fenella", "Gideon", "Hanne", "Ignatius", "Jolene",
    "Kwame", "Lucinda", "Mateus", "Noor",
)  # fmt: skip
LAST_NAMES = (
    "Abernathy", "Balogun", "Castellanos", "Duchamp", "Eriksen", "Fairweather", "Gallagher",
    "Haddad", "Ivanova", "Jankowski", "Kowalczyk", "Lindgren", "Mbeki", "Nakashima", "Oyelaran",
    "Petrakis", "Quintero", "Rasmussen", "Szabo", "Thistlewood", "Underhill", "Varga", "Whitlock",
    "Xu", "Yilmaz", "Zielinski", "Achterberg", "Bramwell", "Cheung", "Delacroix", "Esposito",
    "Fitzgerald", "Grünewald", "Holmqvist", "Iwu", "Jaramillo", "Kristiansen", "Laurent",
    "Moreau", "Nwosu",
)  # fmt: skip

CODENAME_WORDS = (
    "Heron", "Basalt", "Cobalt", "Driftwood", "Ember", "Fjord", "Gannet", "Halyard", "Isotope",
    "Jackdaw", "Kiln", "Lantern", "Monsoon", "Nimbus", "Obsidian", "Petrel", "Quasar", "Rook",
    "Sextant", "Tundra", "Umbra", "Vesper", "Wren", "Xenon", "Yardarm", "Zircon", "Aurora",
    "Bramble", "Cinder", "Dunlin", "Estuary", "Foxglove", "Garnet", "Hawthorn", "Inlet", "Juno",
    "Kittiwake", "Lodestar", "Meridian", "Nettle", "Orrery", "Pumice", "Quill", "Riptide",
    "Saffron", "Tamarind", "Updraft", "Verdigris", "Whinchat", "Yew",
)  # fmt: skip

# Public, shipped Macrohard products (green: safe to mention).
PRODUCTS = (
    "Macrohard Ledger", "Macrohard Relay", "Macrohard Beacon", "Macrohard Canvas",
    "Macrohard Vault", "Macrohard Pulse", "Macrohard Atlas Search", "Macrohard Forms",
)  # fmt: skip

# Macrohard staff (not customers): never labelled.
STAFF = (
    "priya", "dan", "mo", "sasha", "tom.h", "lena", "kofi", "ruth", "jae", "omar", "bea",
    "alex.k", "marta", "ivan", "zoe", "femi",
)  # fmt: skip

SERVICES = (
    "payments-api", "auth-gateway", "search-indexer", "billing-worker", "notifications",
    "ledger-sync", "export-service", "webhooks", "ingest-pipeline", "reporting-api",
)  # fmt: skip

STREETS = (
    "Alder", "Birchwood", "Canal", "Dovecote", "Elm", "Foundry", "Gravel Pit", "Hazel",
    "Kiln", "Linden", "Mill", "Orchard", "Quayside", "Rowan", "Tannery", "Willow",
)  # fmt: skip
STREET_TYPES = ("Street", "Road", "Lane", "Avenue", "Way", "Close", "Drive")
CITIES = (
    ("Portland, OR", "972"), ("Austin, TX", "787"), ("Columbus, OH", "432"),
    ("Raleigh, NC", "276"), ("Madison, WI", "537"), ("Boise, ID", "837"),
)  # fmt: skip
UK_CITIES = (("Leeds", "LS"), ("Bristol", "BS"), ("Norwich", "NR"), ("Cardiff", "CF"))


@cache
def _customers() -> tuple[str, ...]:
    return tuple(f"{s} {x}" for s in CUSTOMER_STEMS for x in CUSTOMER_SUFFIXES)


@cache
def _people() -> tuple[str, ...]:
    return tuple(f"{f} {last}" for f in FIRST_NAMES for last in LAST_NAMES)


@cache
def _pool(name: str, split: Split) -> tuple[str, ...]:
    values = {"customer": _customers(), "person": _people(), "codename": CODENAME_WORDS}[name]
    out = tuple(partition(name, values, split))
    if not out:
        raise ValueError(f"pool {name!r} has no values for split {split!r}")
    return out


def customer(rng: random.Random, split: Split) -> str:
    return rng.choice(_pool("customer", split))


def person(rng: random.Random, split: Split) -> str:
    return rng.choice(_pool("person", split))


def codename(rng: random.Random, split: Split) -> str:
    word = rng.choice(_pool("codename", split))
    return f"Project {word}" if rng.random() < 0.6 else word


# --- Numbers ----------------------------------------------------------------------------------


def money(rng: random.Random, lo: float = 0.2, hi: float = 40.0) -> str:
    cur = rng.choice("$$$$£€")
    v = rng.uniform(lo, hi)
    style = rng.randrange(4)
    if style == 0 and v < 1:
        return f"{cur}{round(v * 1000)}k"
    if style == 1:
        return f"{cur}{v:.1f} million"
    if style == 2:
        return f"{cur}{round(v * 1_000_000, -3):,.0f}"
    return f"{cur}{v:.1f}M" if v >= 1 else f"{cur}{round(v * 1000)}k"


def deal(rng: random.Random, _split: Split) -> str:
    return money(rng, 0.03, 4.0)


def revenue(rng: random.Random, _split: Split) -> str:
    return money(rng, 0.8, 60.0)


def pct(rng: random.Random, lo: float = 1, hi: float = 95, signed: bool = False) -> str:
    v = rng.uniform(lo, hi)
    s = f"{v:.1f}%" if rng.random() < 0.5 else f"{round(v)}%"
    return f"-{s}" if signed and rng.random() < 0.3 else s


def revenue_pct(rng: random.Random, _split: Split) -> str:
    return pct(rng, 2, 80, signed=True)


def metric_pct(rng: random.Random, _split: Split) -> str:
    return pct(rng, 0.5, 97)


def metric_count(rng: random.Random, _split: Split) -> str:
    v = rng.randrange(120, 250_000)
    return f"{v / 1000:.1f}k" if v > 10_000 and rng.random() < 0.4 else f"{v:,}"


def metric_latency(rng: random.Random, _split: Split) -> str:
    if rng.random() < 0.7:
        return f"{rng.randrange(18, 2400)} ms"
    return f"{rng.uniform(1.1, 9.5):.1f} s"


def public_count(rng: random.Random, _split: Split) -> str:
    return rng.choice(("1,000", "2,500", "4,000", "5,000", "10,000", "25,000", "50"))


def public_pct(rng: random.Random, _split: Split) -> str:
    return rng.choice(("99.9%", "99.95%", "99.99%", "30%", "50%", "2x", "40%"))


def small_int(rng: random.Random, _split: Split) -> str:
    return str(rng.randrange(2, 14))


# --- Dates ------------------------------------------------------------------------------------

MONTHS = (
    "January", "February", "March", "April", "May", "June", "July", "August", "September",
    "October", "November", "December",
)  # fmt: skip


def future_date(rng: random.Random, _split: Split) -> str:
    m = rng.randrange(12)
    d = rng.randrange(1, 29)
    return rng.choice(
        (
            f"{MONTHS[m]} {d}",
            f"{d} {MONTHS[m]}",
            f"{MONTHS[m][:3]} {d}",
            f"Q{rng.randrange(1, 5)} 2027",
            f"2027-{m + 1:02d}-{d:02d}",
            f"early {MONTHS[m]}",
            f"{MONTHS[m]} 2027",
        )
    )


def past_date(rng: random.Random, _split: Split) -> str:
    m = rng.randrange(12)
    return rng.choice((f"{MONTHS[m]} 2025", f"{MONTHS[m]} {rng.randrange(1, 29)}, 2026", "last year"))


def clock(rng: random.Random, _split: Split) -> str:
    return f"{rng.randrange(24):02d}:{rng.randrange(60):02d}"


# --- Contact details --------------------------------------------------------------------------


def _domain(company: str) -> str:
    stem = company.split()[0].lower().replace("&", "")
    return stem + (".com", ".co.uk", ".io", ".org")[sum(map(ord, company)) % 4]


def email(rng: random.Random, split: Split) -> str:
    first, last = person(rng, split).lower().split(" ", 1)
    last = last.replace(" ", "").replace("ü", "ue")
    local = rng.choice((f"{first}.{last}", f"{first[0]}{last}", f"{first}", f"{first}_{last[:3]}"))
    return f"{local}@{_domain(customer(rng, split))}"


def phone(rng: random.Random, _split: Split) -> str:
    n = rng.randrange(100, 200)
    if rng.random() < 0.6:
        area = rng.choice(("415", "312", "646", "503", "512", "919"))
        return rng.choice((f"({area}) 555-0{n % 100:02d}{rng.randrange(10)}", f"+1 {area} 555 0{n}"))
    return rng.choice((f"+44 7700 900{n:03d}", f"07700 900{n:03d}"))


def _luhn_complete(prefix: str, length: int, rng: random.Random) -> str:
    digits = prefix + "".join(rng.choice(string.digits) for _ in range(length - len(prefix) - 1))
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return digits + str((10 - total % 10) % 10)


def luhn_valid(number: str) -> bool:
    digits = [int(c) for c in number if c.isdigit()]
    total = 0
    for i, d in enumerate(reversed(digits)):
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def card(rng: random.Random, _split: Split) -> str:
    raw = _luhn_complete(rng.choice(("4000", "4111", "5555", "5105", "4917")), 16, rng)
    sep = rng.choice((" ", "-", ""))
    return sep.join(raw[i : i + 4] for i in range(0, 16, 4))


def card_last4(rng: random.Random, _split: Split) -> str:
    return f"ending {rng.randrange(10000):04d}"


def address(rng: random.Random, _split: Split) -> str:
    street = f"{rng.randrange(2, 980)} {rng.choice(STREETS)} {rng.choice(STREET_TYPES)}"
    if rng.random() < 0.6:
        city, z = rng.choice(CITIES)
        return f"{street}, {city} {z}{rng.randrange(10, 99)}"
    city, pc = rng.choice(UK_CITIES)
    return f"{street}, {city} {pc}{rng.randrange(1, 20)} {rng.randrange(1, 9)}{rng.choice('ABDEFGHJLNPQRSTUWXYZ')}{rng.choice('ABDEFGHJLNPQRSTUWXYZ')}"


def ip(rng: random.Random, _split: Split) -> str:
    first = rng.choice((23, 31, 51, 62, 81, 86, 92, 109, 146, 178, 185, 203, 212))
    return ".".join(str(x) for x in (first, rng.randrange(256), rng.randrange(256), rng.randrange(1, 255)))


# --- Secrets ----------------------------------------------------------------------------------

_B62 = string.ascii_letters + string.digits


def _rand(rng: random.Random, n: int, alphabet: str = _B62) -> str:
    return "".join(rng.choice(alphabet) for _ in range(n))


def secret(rng: random.Random, _split: Split) -> str:
    kind = rng.randrange(9)
    if kind == 0:
        return "AKIA" + _rand(rng, 16, string.ascii_uppercase + "234567")
    if kind == 1:
        return _rand(rng, 40, _B62 + "/+")  # AWS secret access key shape
    if kind == 2:
        return "sk_live_" + _rand(rng, 24)
    if kind == 3:
        return "ghp_" + _rand(rng, 36)
    if kind == 4:
        return f"xoxb-{rng.randrange(10**11, 10**12)}-{rng.randrange(10**12, 10**13)}-{_rand(rng, 24)}"
    if kind == 5:
        return "sk-proj-" + _rand(rng, 48, _B62 + "-_")
    if kind == 6:
        head = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
        return f"{head}.{_rand(rng, 46, _B62 + '-_')}.{_rand(rng, 43, _B62 + '-_')}"
    if kind == 7:
        return "glpat-" + _rand(rng, 20, _B62 + "-_")
    return "SG." + _rand(rng, 22, _B62 + "-_") + "." + _rand(rng, 43, _B62 + "-_")


def password(rng: random.Random, _split: Split) -> str:
    words = ("Tundra", "maple", "Orbit", "copper", "Falcon", "river", "Granite", "lemon")
    if rng.random() < 0.5:
        return f"{rng.choice(words)}{rng.choice('!#$%&*')}{rng.randrange(10, 9999)}{rng.choice(words).lower()}"
    return _rand(rng, rng.randrange(14, 24), _B62 + "!#%&*^")


def db_url(rng: random.Random, split: Split) -> str:
    scheme, port = rng.choice((("postgres", 5432), ("postgresql", 5432), ("mysql", 3306), ("mongodb+srv", 0)))
    user = rng.choice(("svc_billing", "app", "admin", "reporting_ro", "etl"))
    host = f"{rng.choice(('db-prod', 'pg-main', 'analytics', 'orders'))}-{rng.randrange(1, 9)}.internal.{COMPANY_DOMAIN}"
    hostport = host if port == 0 else f"{host}:{port}"
    return f"{scheme}://{user}:{password(rng, split)}@{hostport}/{rng.choice(('billing', 'core', 'events', 'app'))}"


def private_key(rng: random.Random, _split: Split) -> str:
    kind = rng.choice(("RSA PRIVATE KEY", "OPENSSH PRIVATE KEY", "PRIVATE KEY", "EC PRIVATE KEY"))
    body = "\n".join(_rand(rng, 64, _B62 + "+/") for _ in range(rng.randrange(3, 6)))
    return f"-----BEGIN {kind}-----\n{body}\n-----END {kind}-----"


# --- Safe look-alikes (never labelled) -----------------------------------------------------------


def placeholder_key(rng: random.Random, _split: Split) -> str:
    return rng.choice(
        (
            "<YOUR_API_KEY>", "sk_live_REPLACE_ME", "YOUR_TOKEN_HERE", "xxxxxxxxxxxxxxxx",
            "AKIAXXXXXXXXXXXXXXXX", "<redacted>", "${API_TOKEN}", "your-secret-here", "****",
        )
    )  # fmt: skip


def env_name(rng: random.Random, _split: Split) -> str:
    return rng.choice(
        ("STRIPE_SECRET_KEY", "DATABASE_URL", "GITHUB_TOKEN", "SLACK_BOT_TOKEN", "AWS_SECRET_ACCESS_KEY",
         "OPENAI_API_KEY", "SENDGRID_API_KEY", "JWT_SIGNING_KEY")
    )  # fmt: skip


def example_email(rng: random.Random, _split: Split) -> str:
    return rng.choice(
        ("jane@example.com", "user@example.org", "you@yourcompany.com", f"support@{COMPANY_DOMAIN}",
         f"press@{COMPANY_DOMAIN}", "test@example.net", "noreply@example.com")
    )  # fmt: skip


def example_phone(rng: random.Random, _split: Split) -> str:
    return rng.choice(("+1 (800) 555-0100", "1-800-MACROHARD", "+44 20 7946 0000"))


def version(rng: random.Random, _split: Split) -> str:
    return f"v{rng.randrange(1, 6)}.{rng.randrange(0, 20)}" + (f".{rng.randrange(0, 9)}" if rng.random() < 0.5 else "")


def ticket(rng: random.Random, _split: Split) -> str:
    return str(rng.randrange(1000, 99999))


def git_sha(rng: random.Random, _split: Split) -> str:
    return _rand(rng, 40 if rng.random() < 0.5 else 7, "0123456789abcdef")


def uuid(rng: random.Random, _split: Split) -> str:
    h = _rand(rng, 32, "0123456789abcdef")
    return f"{h[:8]}-{h[8:12]}-4{h[13:16]}-a{h[17:20]}-{h[20:]}"


def pick(options: tuple[str, ...]) -> Callable[[random.Random, Split], str]:
    return lambda rng, _split: rng.choice(options)


# --- Slot kinds -------------------------------------------------------------------------------


@dataclass(frozen=True)
class SlotKind:
    generate: Callable[[random.Random, Split], str]
    #: Data type id of the span, or None for unlabelled (safe) text.
    label: str | None


SLOT_KINDS: dict[str, SlotKind] = {
    # Yellow
    "revenue": SlotKind(revenue, L.REVENUE),
    "revenue_pct": SlotKind(revenue_pct, L.REVENUE),
    "metric_pct": SlotKind(metric_pct, L.METRICS),
    "metric_count": SlotKind(metric_count, L.METRICS),
    "metric_latency": SlotKind(metric_latency, L.METRICS),
    "deal": SlotKind(deal, L.DEAL),
    "customer": SlotKind(customer, L.CUSTOMER),
    # Red
    "codename": SlotKind(codename, L.ROADMAP),
    "launch_date": SlotKind(future_date, L.ROADMAP),
    "secret": SlotKind(secret, L.SECRET),
    "password": SlotKind(password, L.SECRET),
    "db_url": SlotKind(db_url, L.SECRET),
    "private_key": SlotKind(private_key, L.SECRET),
    "person": SlotKind(person, L.PERSONAL),
    "email": SlotKind(email, L.PERSONAL),
    "phone": SlotKind(phone, L.PERSONAL),
    "card": SlotKind(card, L.PERSONAL),
    "address": SlotKind(address, L.PERSONAL),
    "ip": SlotKind(ip, L.PERSONAL),
    # Unlabelled look-alikes and filler
    "launched_codename": SlotKind(codename, None),
    "product": SlotKind(pick(PRODUCTS), None),
    "staff": SlotKind(pick(STAFF), None),
    "service": SlotKind(pick(SERVICES), None),
    "public_count": SlotKind(public_count, None),
    "public_pct": SlotKind(public_pct, None),
    "small_int": SlotKind(small_int, None),
    "past_date": SlotKind(past_date, None),
    # A future date that has already been announced publicly (not unreleased roadmap).
    "announced_date": SlotKind(future_date, None),
    "git_sha": SlotKind(git_sha, None),
    "uuid": SlotKind(uuid, None),
    "clock": SlotKind(clock, None),
    "placeholder_key": SlotKind(placeholder_key, None),
    "env_name": SlotKind(env_name, None),
    "example_email": SlotKind(example_email, None),
    "example_phone": SlotKind(example_phone, None),
    "card_last4": SlotKind(card_last4, None),
    "version": SlotKind(version, None),
    "ticket": SlotKind(ticket, None),
    "company": SlotKind(pick((COMPANY,)), None),
}
