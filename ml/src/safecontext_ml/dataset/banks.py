"""Snippet banks for the offline "Macrohard" generator.

A document is a header plus a few snippets from a genre's banks. Slots (`{{kind}}`) are listed in
`values.SLOT_KINDS`; labelled kinds become spans, unlabelled kinds are safe look-alikes.

SPLITS: a snippet's split is fixed by its position in its bank (`snippet_split`): positions
3, 13, 23, ... are dev, 7, 17, 27, ... are test, the rest train. So **only append to a bank; never
reorder, insert or delete**, or snippets move between splits and the frozen test set changes.
Each bank has at least 18 snippets so dev and test both get two.

LABELLING RULES (also in ml/README.md):
- Numbers: the span is the number with its currency, magnitude and unit ("$4.2M", "18%", "340 ms",
  "3,412"), not the words around it ("revenue", "up").
- Roadmap: the codename ("Project Heron" or "Heron") and the planned date of an unreleased launch.
  A codename that already shipped publicly, or a publicly announced date, is not labelled.
- People: a customer's or end user's name and contact details are personal data. Macrohard staff
  (chat handles like "priya") are not labelled.
- Placeholders, env var names, example.com addresses and masked values ("ending 4242") are safe.
"""

from __future__ import annotations

from dataclasses import dataclass

from . import labels as L
from .split import Split


@dataclass(frozen=True)
class Snippet:
    text: str
    #: Labels this snippet imitates without containing (hard negative).
    negative_for: tuple[str, ...] = ()


def N(text: str, *labels: str) -> Snippet:
    return Snippet(text, labels)


def snippet_split(index: int) -> Split:
    if index % 10 == 3:
        return "dev"
    if index % 10 == 7:
        return "test"
    return "train"


def _bank(*items: str | Snippet) -> tuple[Snippet, ...]:
    return tuple(i if isinstance(i, Snippet) else Snippet(i) for i in items)


BANKS: dict[str, tuple[Snippet, ...]] = {
    # Slack messages with sensitive content.
    "chat": _bank(
        "{{customer}} just signed the renewal, {{deal}} over two years 🎉",
        "heads up: {{codename}} is slipping to {{launch_date}}, don't tell sales yet",
        "weekly actives are at {{metric_count}}, up from last month",
        "can someone rotate the key? I pasted {{secret}} in #general by accident",
        "Q3 bookings closed at {{revenue}}, which is {{revenue_pct}} over plan",
        "{{customer}} is threatening to churn unless we fix SSO",
        "p95 on {{service}} is {{metric_latency}} since the deploy",
        "{{person}} from {{customer}} emailed again ({{email}}), she wants a call on {{phone}}",
        "gross margin landed at {{revenue_pct}} this quarter",
        "we're demoing {{codename}} to {{customer}} under NDA on {{launch_date}}",
        "trial-to-paid conversion is {{metric_pct}}, lowest since spring",
        "the db creds are {{db_url}} if you need them for the backfill",
        "{{customer}} wants {{deal}} off list price or they walk",
        "ARR crossed {{revenue}} 🎉 (internal only please)",
        "churn in SMB was {{metric_pct}} last month",
        "staging password is {{password}}, same as prod lol",
        "can we ship {{codename}} behind a flag by {{launch_date}}?",
        "refund for {{person}}, card {{card}}, billing address {{address}}",
        "{{customer}} renewal is {{deal}}, signed today",
        "error rate on {{service}} hit {{metric_pct}} during the incident",
    ),
    # Slack messages that are safe, many of them look-alikes.
    "chat_neutral": _bank(
        "PR is up for review, small one",
        "lunch at 12:30?",
        N("{{product}} docs are live on the website now", L.ROADMAP),
        "can someone review my PR for {{service}}?",
        "standup moved to 10 tomorrow",
        N("the public status page says {{public_pct}} uptime for {{past_date}}", L.METRICS),
        N("reminder: never paste keys here, use the vault and read {{env_name}} from the env", L.SECRET),
        N("{{launched_codename}} shipped publicly in {{past_date}}, nice work all", L.ROADMAP),
        "who owns the {{service}} dashboard?",
        N("the press release says {{public_count}}+ customers, use that number in the deck", L.METRICS),
        "thanks!",
        "anyone else seeing flaky tests on main?",
        "{{staff}} is out today, ping me instead",
        N("use {{example_email}} in the screenshots, not real addresses", L.PERSONAL),
        N("the API docs example uses {{placeholder_key}} as the key", L.SECRET),
        "merged 🚀",
        N("{{product}} {{version}} is out, release notes are on the blog", L.ROADMAP),
        N("our SLA is {{public_pct}}, it's on the pricing page", L.METRICS),
        N("build {{git_sha}} is green, deploying", L.SECRET),
        "retro notes are in the wiki",
    ),
    # Incident timeline entries.
    "incident": _bank(
        "{{service}} error rate climbed to {{metric_pct}}; paging on-call",
        "Root cause: a config push logged {{env_name}} (value {{secret}}); key revoked",
        "{{customer}} reported failed checkouts; {{metric_count}} requests affected",
        "Connection string leaked in a stack trace: {{db_url}}",
        "p99 latency {{metric_latency}} against a baseline of {{metric_latency#2}}",
        "Rolled back {{service}} to the previous build",
        "Blocked abusive traffic from {{ip}}",
        "Customer {{person}} ({{email}}) saw another user's invoice; {{metric_count}} invoices exposed. Rotated {{secret}}",
        "Status page updated",
        "Error budget for the month is down to {{metric_pct}}",
        "{{customer}} escalated through their account manager",
        "Disk on {{service}} at {{metric_pct}}; added capacity",
        N("Follow-up: move {{env_name}} into the secrets manager", L.SECRET),
        "Admin password {{password}} was in the runbook; changed it. Error rate peaked at {{metric_pct}}",
        "Queue depth peaked at {{metric_count}} messages",
        "Requests from {{ip}} and {{ip#2}} tripped the WAF rule",
        N("Deploy {{git_sha}} reverted; request id {{uuid}} for the trace", L.SECRET),
        "{{customer}} lost {{metric_count}} webhook deliveries; we replayed them. Their SLA credit is {{deal}}",
        "Monitoring alert cleared",
        "On-call handed over to {{staff}}",
    ),
    # Support ticket bodies.
    "support": _bank(
        "Hi, our invoices since {{past_date}} are wrong. Please call me on {{phone}}.",
        "Please update our billing address to {{address}}.",
        "I was charged twice on card {{card}}.",
        "Our admin {{person#2}} ({{email#2}}) can't log in.",
        "We pay {{deal}} a year and still have no SLA.",
        N("Can you confirm the card {{card_last4}} was removed from our account?", L.PERSONAL),
        "The export job fails for our {{metric_count}} records.",
        "This is {{person}} again. My number changed to {{phone}}; ship the replacement to {{address}} and bill card {{card}}.",
        "Logins fail from IP {{ip}}.",
        "Will {{codename}} fix this? Our rep said it lands {{launch_date}}.",
        "Thanks, that worked.",
        "Our renewal quote was {{deal}}, but we were told {{deal#2}}.",
        "Please send the receipt to {{email#2}} instead.",
        "{{metric_count}} of our users can't export since {{past_date}}; who is our customer success manager?",
        "I pasted our API key {{secret}} into the last message by mistake, please delete it.",
        N("The help page tells me to email {{example_email}}, is that right?", L.PERSONAL),
        "Account holder: {{person#2}}, {{address}}, {{phone}}.",
        "Identity check failed for {{person}} at {{address}}; please call {{phone}}.",
        "Can we get the invoice in euros?",
        "Our IT team allow-listed {{ip}} but it still fails.",
    ),
    # Launch review bullets.
    "launch": _bank(
        "Target GA: {{launch_date}}",
        "Beta cohort: {{customer}}, {{customer#2}} and {{customer#3}}",
        "Beta adoption is {{metric_pct}} of invited accounts",
        "{{customer}} pre-committed {{deal}} contingent on {{codename}}",
        "Risk: {{service}} capacity; p95 currently {{metric_latency}}",
        "Press embargo until {{launch_date}}",
        "Exit criteria: crash-free sessions above {{metric_pct}}",
        "{{codename}} launch moves to {{launch_date}}; {{metric_count}} waitlist sign-ups so far",
        "Docs owner: {{staff}}",
        "Forecast: {{revenue}} new ARR in the first year",
        "{{customer}} chose us over the incumbent because of {{codename}}",
        "Open question: announce at the conference on {{launch_date}}?",
        "Pilot retention: {{metric_pct}} at week 4",
        "Pilot feedback from {{customer}}: weekly usage up to {{metric_pct}}, {{metric_count}} active seats",
        "Load test: {{metric_count}} rps at {{metric_latency}} p99",
        "Decision: go",
        "Depends on {{service}} {{version}}",
        "{{customer}} signed a {{deal}} pilot for {{codename}}; GA revenue target {{revenue}}",
        "Pricing page update ready for {{launch_date}}",
        "Support runbook drafted",
    ),
    # Internal finance updates.
    "finance": _bank(
        "{{company}} closed the quarter at {{revenue}} in revenue, {{revenue_pct}} year over year.",
        "Gross margin: {{revenue_pct}} (plan {{revenue_pct#2}}).",
        "Net revenue retention was {{metric_pct}}.",
        "Bookings were {{revenue}}, led by the {{customer}} expansion ({{deal}}).",
        "Burn is {{revenue}} a month.",
        "Top three accounts: {{customer}}, {{customer#2}}, {{customer#3}}.",
        "EBITDA margin improved to {{revenue_pct}}.",
        "{{customer}} renewed at {{deal}}, up from {{deal#2}}; total ARR is now {{revenue}}.",
        "Logo churn: {{metric_pct}}.",
        "Pipeline for next quarter: {{revenue}}.",
        "The pricing change adds an estimated {{revenue}} a year.",
        "{{customer}} is {{metric_pct}} of revenue, a concentration risk.",
        "Monthly active seats: {{metric_count}}.",
        "ARR grew {{revenue_pct}} to {{revenue}}.",
        "Deferred revenue: {{revenue}}.",
        "Average enterprise deal: {{deal}}.",
        "The board deck draft is in the finance folder.",
        "We expect {{revenue}} from {{codename}} in its first year after {{launch_date}}.",
        "Cash collected in {{past_date}}: {{revenue}}.",
        "Headcount plan is unchanged.",
    ),
    # Sales and deal-desk notes.
    "sales": _bank(
        "{{customer}}: verbal yes on {{deal}}, paperwork next week.",
        "Champion at {{customer}} is {{person}} ({{email}}, {{phone}}).",
        "{{customer}} renewal at risk; current contract {{deal}}.",
        "Closed-won: {{customer}}, {{deal}} over three years.",
        "Lost {{customer}} to a competitor on price.",
        "{{customer}} asked about {{codename}}; told them {{launch_date}} under NDA.",
        "Next step: security review with {{customer}}.",
        "{{customer}} signed! {{deal}} ACV. Contact: {{person}}, {{email}}.",
        "Sent the public pricing page to {{customer}}.",
        "Expansion: {{customer}} adding seats, +{{deal}}.",
        "{{customer}} pays {{deal}} a year for {{product}}.",
        "Team forecast this quarter: {{revenue}}.",
        "{{customer}} procurement contact: {{person}}, {{phone}}.",
        "{{customer}} upsell: {{deal}}.",
        "Demo went well.",
        "Ask legal about the {{customer}} MSA.",
        "Win rate this quarter: {{metric_pct}}.",
        "{{customer}} wants to pilot {{codename}}; budget {{deal}}.",
        "Follow up with {{customer}} after {{past_date}}.",
        "Quota attainment: {{metric_pct}}.",
    ),
    # Code and config with secrets or customer data.
    "code": _bank(
        'import stripe\n\nstripe.api_key = "{{secret}}"\n',
        "DATABASE_URL={{db_url}}\nLOG_LEVEL=info\nAPI_TOKEN={{secret}}\n",
        'const client = new Client({ token: "{{secret}}", retries: 3 });\n',
        "apiVersion: v1\nkind: Secret\nstringData:\n  username: admin\n  password: {{password}}\n",
        'curl -H "Authorization: Bearer {{secret}}" https://api.macrohard.io/v2/orders  # {{customer}} tenant\n',
        "INSERT INTO customers (name, email, phone) VALUES ('{{person}}', '{{email}}', '{{phone}}');\n",
        "services:\n  db:\n    image: postgres:18\n    environment:\n      POSTGRES_PASSWORD: {{password}}\n",
        'conn = psycopg.connect("{{db_url}}")\n# sandbox for {{customer}}\nAWS_SECRET = "{{secret}}"\n',
        "$ cat ~/.ssh/id_ed25519\n{{private_key}}\n",
        'fixture = {"customer": "{{customer}}", "contact": "{{email}}", "card": "{{card}}"}\n',
        "+  slack_token: {{secret}}\n+  channel: '#alerts'\n",
        'provider "aws" {\n  access_key = "{{secret}}"\n  secret_key = "{{secret#2}}"\n}\n',
        'logger.info("charged %s at %s", "{{card}}", "{{address}}")\n',
        "//registry.npmjs.org/:_authToken={{secret}}\n",
        'REDIS_URL = "redis://:{{password}}@cache-1.internal.macrohard.io:6379/0"\n',
        "tls:\n  key: |\n    {{private_key}}\n",
        "users = [\n    User(name=\"{{person}}\", email=\"{{email}}\", ip=\"{{ip}}\"),\n]\n",
        'export {{env_name}}="{{secret}}"\n',
        "# TODO remove before merge\nADMIN_PASSWORD = '{{password}}'\n",
        'headers = {"X-Api-Key": "{{secret}}"}\n',
    ),
    # Code with no secrets: env lookups, placeholders, hashes, open-source style snippets.
    "code_neutral": _bank(
        N('api_key = os.environ["{{env_name}}"]\n', L.SECRET),
        N("# .env.example\n{{env_name}}={{placeholder_key}}\n", L.SECRET),
        "export function useDebounce(value, delay) {\n  const [v, setV] = useState(value);\n  useEffect(() => {\n    const t = setTimeout(() => setV(value), delay);\n    return () => clearTimeout(t);\n  }, [value, delay]);\n  return v;\n}\n",
        N("# Replace {{placeholder_key}} with your own key before running.\n", L.SECRET),
        N('assert is_valid_email("{{example_email}}")\n', L.PERSONAL),
        "def luhn_ok(number: str) -> bool:\n    digits = [int(c) for c in number if c.isdigit()]\n    return sum(digits) % 10 == 0  # simplified\n",
        N("password = getpass.getpass('Password: ')\n", L.SECRET),
        N("const token = process.env.{{env_name}};\n", L.SECRET),
        N("DATABASE_URL=postgres://localhost:5432/dev\n", L.SECRET),
        N("vault kv get secret/{{service}}\n", L.SECRET),
        'EMAIL_RE = re.compile(r"[^@\\s]+@[^@\\s]+\\.[a-z]+")\n',
        N('digest = hashlib.sha256(b"hello").hexdigest()\nassert len(digest) == 64\n', L.SECRET),
        N("commit {{git_sha}}\nAuthor: {{staff}}\n\n    Fix flaky retry test\n", L.SECRET),
        N("docker run -e {{env_name}}=$SECRET {{service}}:latest\n", L.SECRET),
        '{\n  "name": "{{service}}",\n  "version": "{{version}}",\n  "license": "MIT"\n}\n',
        N("server.listen(8080, '0.0.0.0');\n// health: curl http://127.0.0.1:8080/health\n", L.PERSONAL),
        N("request_id = '{{uuid}}'\nchecksum = 'sha256:{{git_sha}}'\n", L.SECRET),
        N("git clone https://github.com/macrohard/sdk.git\n# report issues to {{example_email}}\n", L.PERSONAL),
        "for i in range(10):\n    print(i ** 2)\n",
        N("STRIPE_KEY: ${{ secrets.STRIPE_KEY }}\n", L.SECRET),
    ),
    # Public press release sentences (hard negatives).
    "press": _bank(
        N("{{company}} today announced the general availability of {{product}}, now used by more than {{public_count}} teams.", L.ROADMAP, L.METRICS),
        N("{{product}} {{version}} is available today at no extra cost.", L.ROADMAP),
        N("The release follows a public preview in {{past_date}}.", L.ROADMAP),
        N("{{launched_codename}}, first previewed at our annual conference, is now generally available.", L.ROADMAP),
        N("Media contact: {{example_email}}, {{example_phone}}.", L.PERSONAL),
        N("{{company}} offers a {{public_pct}} uptime SLA on all paid plans.", L.METRICS),
        "About {{company}}: {{company}} builds software for finance teams.",
        N("{{product}} cuts reconciliation time by up to {{public_pct}}, according to a {{past_date}} customer survey.", L.METRICS, L.REVENUE),
        N("Pricing starts at $12 per user per month.", L.DEAL, L.REVENUE),
        "The company was founded in 2019 and is headquartered in Leeds.",
        N("{{product}} will be available in the EU region from {{announced_date}}, as announced today.", L.ROADMAP),
        "This press release contains forward-looking statements.",
        N("{{company}} now serves {{public_count}} customers in 30 countries.", L.METRICS),
        N("Registration for the user conference on {{announced_date}} is open.", L.ROADMAP),
        "Analysts named {{company}} a leader in its category.",
        N("{{company}} does not disclose revenue.", L.REVENUE),
        "Visit the website for more information.",
        N("Following its {{past_date}} launch, {{launched_codename}} is available to every plan.", L.ROADMAP),
        N("The free tier includes {{public_count}} API calls a month.", L.METRICS),
        "Customers can upgrade from the billing page.",
    ),
    # Public release notes (hard negatives).
    "release": _bank(
        "Added: dark mode for {{product}}.",
        "Fixed: CSV export failing on files over 10 MB.",
        N("{{launched_codename}} is now available to all customers.", L.ROADMAP),
        N("Improved: search is up to {{public_pct}} faster.", L.METRICS),
        N("Deprecated: the v1 webhooks API will be removed on {{announced_date}}.", L.ROADMAP),
        N("Security: we rotated our signing keys; no action is needed.", L.SECRET),
        N("Fixed a bug where the {{example_email}} placeholder showed in invites.", L.PERSONAL),
        N("{{product}} {{version}}: SCIM provisioning for SSO; the EU region opens on {{announced_date}}.", L.ROADMAP),
        "Changed: the default session timeout is now 30 minutes.",
        N("The API rate limit is now {{public_count}} requests per minute.", L.METRICS),
        "Fixed: the date picker now respects your locale.",
        N("{{product}} {{version}} adds audit logs.", L.ROADMAP),
        "Removed: the legacy Internet Explorer stylesheet.",
        N("New: rotate API keys from the settings page instead of emailing {{example_email}}.", L.SECRET, L.PERSONAL),
        "Improved: clearer error messages when an upload fails.",
        N("As announced in {{past_date}}, {{launched_codename}} is out of beta.", L.ROADMAP),
        "Fixed: duplicate notifications on mobile.",
        N("Coming {{announced_date}} (announced at our conference): {{product}} offline mode.", L.ROADMAP),
        "Docs: new quick-start guide.",
        N("Performance: dashboards load in under {{public_count}} ms on average.", L.METRICS),
    ),
    # Public documentation (hard negatives).
    "docs": _bank(
        N("To authenticate, send your key in the header: `Authorization: Bearer {{placeholder_key}}`.", L.SECRET),
        N("Rate limits: {{public_count}} requests per minute per key.", L.METRICS),
        "Webhooks are retried up to {{small_int}} times with exponential backoff.",
        N("Questions? Contact {{example_email}}.", L.PERSONAL),
        "All timestamps are ISO 8601 in UTC.",
        N("Set `{{env_name}}` in your environment; never commit it.", L.SECRET),
        "Pagination uses an opaque `cursor` parameter.",
        N("Example: `curl -u {{placeholder_key}}: https://api.macrohard.io/v1/invoices`", L.SECRET),
        "Errors use standard HTTP status codes such as 400, 401 and 429.",
        N("The sandbox accepts any email ending in @example.com, for example {{example_email}}.", L.PERSONAL),
        "Objects are deleted after 30 days in the trash.",
        N("Our uptime target is {{public_pct}}; see the status page for history.", L.METRICS),
        "The SDK supports Python 3.10 and later.",
        N("Request IDs look like `{{uuid}}`; include one when you contact support.", L.SECRET),
        "Use idempotency keys to retry POST requests safely.",
        N("Support line: {{example_phone}}.", L.PERSONAL),
        "Field names are snake_case.",
        N("Store the key from `{{env_name}}` in your secrets manager, not in code.", L.SECRET),
        "Batch endpoints accept up to 100 items.",
        "See the changelog for breaking changes.",
    ),
}  # fmt: skip


def bank_for_split(bank: str, split: Split) -> list[tuple[str, Snippet]]:
    """(snippet id, snippet) pairs of `bank` that belong to `split`."""
    return [
        (f"{bank}-{i:03d}", s)
        for i, s in enumerate(BANKS[bank])
        if snippet_split(i) == split
    ]
