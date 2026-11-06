/**
 * What each persona would type or have Claude read, and what Safe Context should do with it.
 * The personas live in the SafeContext/MacroHard repo. `demo/check.ts` sends each scenario
 * through a running agent and compares; `--list` prints them as MacroHard's TRY-THESE.md.
 *
 * Expectations assume the demo policy: the default data types plus the dashboard seed's word
 * lists (Northwind, Acme Corp, Contoso; Project Atlas, Project Helios), with tiers 1 and 2 on.
 *
 * `expect` is what happens today. Where today's behaviour falls short, `gap` says how, so the
 * guide shows it and a fix shows up here as a changed result.
 */

export type Persona = 'dev' | 'pm' | 'sales';

type Base = {
	persona: Persona;
	why: string;
	/** What Safe Context misses or gets wrong here today. */
	gap?: string;
};

export type Scenario = Base &
	(
		/** Something the person types. `block` stops it; `allow` lets it through unchanged. */
		| { kind: 'prompt'; text: string; expect: 'allow' | 'block' }
		/** Claude reads a file in the persona's folder. `clean` = Claude sees a cleaned copy. */
		| {
				kind: 'read';
				file: string;
				expect: 'clean' | 'unchanged';
				/** Text that must not reach Claude (checked on `clean`). */
				hides?: string[];
		  }
		/** Claude runs a shell command. `block` stops the tool call before it runs. */
		| { kind: 'bash'; command: string; expect: 'allow' | 'block' }
		/**
		 * Claude reads `file`, then writes `to` using the placeholders it saw (#83). `restored`: the
		 * written file gets the real values in `restores`; `refused`: the write is denied.
		 */
		| { kind: 'write'; file: string; to: string; restores?: string[]; expect: 'restored' | 'refused' }
		/** Claude lists `folder` (`ls`), then opens `opens` by the name it saw there (#83). */
		| { kind: 'open'; folder: string; opens: string; expect: 'restored' }
	);

export const SCENARIOS: Scenario[] = [
	// ---------------------------------------------------------------- dev
	{
		persona: 'dev',
		kind: 'prompt',
		text: 'Add an idempotency key to chargeCard in src/billing/stripe.ts so retries do not double-charge.',
		expect: 'allow',
		why: 'Ordinary coding request with nothing sensitive in it.'
	},
	{
		persona: 'dev',
		kind: 'read',
		file: 'logs/checkout-errors.log',
		expect: 'clean',
		hides: ['jane.doe@northwind.com', '4242 4242 4242 4242', '+44 20 7946 0958'],
		why: 'Ask Claude to "read the checkout error log and work out why payments fail". The log has customer emails, card numbers and a phone number; Claude gets labelled placeholders such as ⟪customer_personal_data_1⟫ instead.',
		gap: 'Tier 1 tags "404 4ms" as a metric, so Claude sees a placeholder with the hint "a few hundred ms", which is wrong (it is at least marked as hidden now). It also tags one account id as personal data.'
	},
	{
		persona: 'dev',
		kind: 'read',
		file: '.env',
		expect: 'clean',
		hides: ['sk_live_', 'AKIA', 'ghp_', 'hooks.slack.com/services/'],
		why: 'Ask "why can\'t the app connect to Stripe? check .env". The keys are hidden before Claude sees the file.'
	},
	{
		persona: 'dev',
		kind: 'read',
		file: 'scripts/notify-deploy.sh',
		expect: 'clean',
		hides: ['hooks.slack.com/services/'],
		why: 'Ask Claude to "make notify-deploy.sh read the webhook from the environment". The hard-coded Slack webhook is hidden from what Claude reads.'
	},
	{
		persona: 'dev',
		kind: 'write',
		file: 'scripts/notify-deploy.sh',
		to: '.env.local',
		restores: ['hooks.slack.com/services/'],
		expect: 'restored',
		why: 'Then ask "move the webhook into .env.local". Claude writes SLACK_WEBHOOK_URL=⟪secret_1⟫, and the file gets the real webhook, which Claude never sees.'
	},
	{
		persona: 'dev',
		kind: 'write',
		file: 'scripts/notify-deploy.sh',
		to: '.claude/notes.md',
		expect: 'refused',
		why: 'Real values never go into hidden folders such as .claude or .git: in auto mode Claude Code would send that write to Anthropic for a safety check. Claude is told why and can write elsewhere.'
	},
	{
		persona: 'dev',
		kind: 'read',
		file: 'src/routes/checkout.ts',
		expect: 'unchanged',
		why: 'Plain source code goes through untouched.'
	},
	{
		persona: 'dev',
		kind: 'read',
		file: 'docs/incident-2026-11-02.md',
		expect: 'clean',
		hides: ['Acme Corp'],
		why: 'Ask Claude to "turn the incident doc into a status update". The affected customer\'s name is swapped for a placeholder.'
	},
	{
		persona: 'dev',
		kind: 'prompt',
		text: 'Checkout is failing for jane.doe@northwind.com with card_declined, can you find out why?',
		expect: 'block',
		why: "A customer's email address in a prompt is blocked; Safe Context offers a version with a placeholder."
	},
	{
		persona: 'dev',
		kind: 'prompt',
		text: 'Why does Stripe reject this key? __FAKE_STRIPE_KEY__',
		expect: 'block',
		why: 'Pasting a live API key is blocked. (Copy a real-looking key from your .env to try it.)'
	},
	{
		persona: 'dev',
		kind: 'bash',
		command:
			'curl -s https://api.stripe.com/v1/charges -u __FAKE_STRIPE_KEY__: | head',
		expect: 'block',
		why: 'The backstop: if a key ever reaches Claude by a route Safe Context doesn\'t check yet (an @file mention, #38) and Claude puts it in a command, the tool call is stopped. Hard to trigger by hand, since typing the key is blocked first.'
	},
	{
		persona: 'dev',
		kind: 'prompt',
		text: 'Can you ask Richard to review the checkout PR once tests pass?',
		expect: 'allow',
		why: "People's names aren't sensitive."
	},

	// ---------------------------------------------------------------- pm
	{
		persona: 'pm',
		kind: 'prompt',
		text: 'Draft a tweet announcing Flow Canvas, our new visual workflow editor.',
		expect: 'allow',
		why: 'Canvas is public, so this goes straight through.'
	},
	{
		persona: 'pm',
		kind: 'prompt',
		text: 'Write a short team update: Project Atlas GA is moving from 3 March to 7 April because the hosting contract is late.',
		expect: 'block',
		why: 'Project Atlas is on IT\'s "unreleased roadmap" word list, which is never shared.'
	},
	{
		persona: 'pm',
		kind: 'read',
		file: 'roadmap/2027-roadmap.md',
		expect: 'clean',
		hides: ['Project Atlas', 'Project Helios'],
		why: 'Ask Claude to "summarise the 2027 roadmap". The codenames are removed from what it reads.',
		gap: 'Only the full listed names are caught. "Helios moves to Q3" and "Atlas depends on…" still get through. IT would add "Atlas" and "Helios" to the word list.'
	},
	{
		persona: 'pm',
		kind: 'prompt',
		text: 'Write a teaser for Lumen, our smart scheduling feature launching on 14 January.',
		expect: 'block',
		why: 'Lumen isn\'t on IT\'s word list, but tier 1 recognises an unannounced feature with a launch date as unreleased roadmap.'
	},
	{
		persona: 'pm',
		kind: 'read',
		file: 'launches/lumen-launch-plan.md',
		expect: 'clean',
		hides: ['Lumen'],
		why: 'Ask Claude to "tighten up the Lumen launch plan". "Lumen" is hidden here because Safe Context flagged it in the teaser prompt above, earlier in the same session: a value hidden once stays hidden for the rest of the session (#83).',
		gap: 'In a fresh session the whole unannounced plan goes through: tier 1 doesn\'t pick out "Lumen" on its own, and it isn\'t on the word list. IT adding "Lumen" to the list fixes it.'
	},
	{
		persona: 'pm',
		kind: 'read',
		file: 'metrics/weekly-update-2026-w44.md',
		expect: 'clean',
		hides: ['$4.2M', '48,200'],
		why: 'Ask "turn this week\'s update into three bullet points". Revenue and metrics are "make it vague": Claude sees ⟪revenue_figure_1: over $4M⟫ rather than the exact figure, and a file it writes gets the exact figures back.',
		gap: 'Some hints say little: in "churn rose to 2.9% from 2.4%" both values get "single digits". Claude can still tell they are two different values.'
	},
	{
		persona: 'pm',
		kind: 'read',
		file: 'press/2026-09-flow-canvas-launch.md',
		expect: 'unchanged',
		why: 'A press release that has gone out is public; tier 2 sees the context and lets it through.'
	},
	{
		persona: 'pm',
		kind: 'read',
		file: 'research/customer-interviews-2026-10.md',
		expect: 'clean',
		hides: ['Northwind', 'Contoso'],
		why: 'Ask "what are the themes from October\'s interviews?". Customer company names are swapped for placeholders; the people\'s names stay.'
	},
	{
		persona: 'pm',
		kind: 'prompt',
		text: 'Q3 revenue was $4.2M, up 18%. Write two sentences for the board pack.',
		expect: 'allow',
		why: 'Revenue is "make it vague", which for now only applies to what Claude reads, not to prompts (issue #50).'
	},

	// ---------------------------------------------------------------- sales
	{
		persona: 'sales',
		kind: 'read',
		file: 'crm/accounts-export-2026-11-02.csv',
		expect: 'clean',
		hides: ['hannah.lewis@northwind.com', '+44 20 7946 0123', 'Acme Corp'],
		why: 'Ask "which accounts renew in the next three months?". Contact details and customer names are replaced; seats, dates and stages stay.',
		gap: 'Only the customers on IT\'s list are hidden. Fabrikam, Tailspin Toys and Wide World Importers stay, and the ARR column isn\'t made vague.'
	},
	{
		persona: 'sales',
		kind: 'read',
		file: 'emails/acme-followup-draft.md',
		expect: 'clean',
		hides: ['tom.becker@acmecorp.com', '+44 20 7946 0777'],
		why: 'Ask Claude to "make this email shorter". The email address and phone number are replaced; "Hi Tom" stays.'
	},
	{
		persona: 'sales',
		kind: 'read',
		file: 'deals/northwind-renewal.md',
		expect: 'clean',
		hides: ['Northwind', 'procurement@northwind.com'],
		why: 'Ask "help me plan Thursday\'s call". The customer, their procurement email and the deal size are hidden or made vague.'
	},
	{
		persona: 'sales',
		kind: 'open',
		folder: 'deals',
		opens: 'northwind-renewal.md',
		expect: 'restored',
		why: 'Ask "what\'s in my deals folder?". Claude sees ⟪customer_name_1⟫-renewal.md, and opening that name opens the real file (#83). Before, Claude saw customer_name_1-renewal.md and couldn\'t open it.'
	},
	{
		persona: 'sales',
		kind: 'write',
		file: 'emails/acme-followup-draft.md',
		to: 'emails/acme-followup-v2.md',
		restores: ['tom.becker@acmecorp.com', '+44 20 7946 0777'],
		expect: 'restored',
		why: 'Ask "make this email shorter and save it as acme-followup-v2.md". Claude only sees placeholders for Tom\'s address and the phone number, but the saved email has the real ones.'
	},
	{
		persona: 'sales',
		kind: 'prompt',
		text: 'Draft a follow-up email to hannah.lewis@northwind.com about the renewal.',
		expect: 'block',
		why: "A customer's email address in a prompt is blocked."
	},
	{
		persona: 'sales',
		kind: 'prompt',
		text: 'What is a good way to handle a customer asking for 18% off a three-year renewal?',
		expect: 'allow',
		why: 'General sales advice with nothing sensitive.'
	},
	{
		persona: 'sales',
		kind: 'prompt',
		text: 'Northwind want 18% off their $1.1M renewal. Write me a negotiation plan.',
		expect: 'allow',
		why: 'Customer names and deal sizes are "make it vague", which for now only applies to what Claude reads, not to prompts (issue #50).'
	},
	{
		persona: 'sales',
		kind: 'read',
		file: 'playbook/discount-guidelines.md',
		expect: 'unchanged',
		why: 'Internal guidance with no sensitive data goes through untouched.'
	}
];
