# Demo: Macrohard personas

Three people at a made-up company, Macrohard, each with a folder of realistic work files. Open a
persona's folder in Claude Code and Safe Context is on. Open any other folder and it's off, so it
doesn't get in the way of your normal work.

| Persona | Folder | What's in it |
| --- | --- | --- |
| **Dev** | `~/macrohard/dev` | `orders-api`, a checkout service: a git repo with a `.env` of fake keys, staging logs with customer emails and card numbers, a script with a hard-coded Slack webhook |
| **PM** | `~/macrohard/pm` | Priya Shah's docs: the 2027 roadmap (Project Atlas, Project Helios), an unannounced launch plan, a public press release, weekly metrics, customer interview notes |
| **Sales** | `~/macrohard/sales` | Marcus Reid's files: a CRM export, a renewal deal, an email draft, call notes, the discount playbook |

The names and numbers match the dashboard's demo organisation: its word lists hold Northwind,
Acme Corp and Contoso (customer names) and Project Atlas and Project Helios (unreleased roadmap).

## Set up (once)

From the repo, with Node 24 (`nvm use`) and the models downloaded (`pnpm models:pull`):

```bash
demo/setup.sh
```

This copies the personas to `~/macrohard` and generates fresh fake API keys. (The repo holds no
key-shaped strings, so GitHub's push protection doesn't object.) It also writes
`~/macrohard/TRY-THESE.md`, a list of things to try with the result to expect. Run it again
with `--force` to start over; the old copy is moved aside, not deleted.

The folders live outside the repo on purpose: Claude Code loads `CLAUDE.md` files from parent
folders, and the repo's own developer instructions would spoil the test.

## Use it

1. **Start the agent** and leave it running:

   ```bash
   demo/start-agent.sh
   ```

   It starts Ollama (tier 2) if it isn't already running, and the agent with tiers 0, 1 and 2.
   Wait for `tier1_ready` and `tier2_ready`. Ctrl-C stops both.

2. **Open a persona in Claude Code:**
   - **Terminal:** `cd ~/macrohard/pm && claude`
   - **Desktop app:** start a new session and choose `~/macrohard/pm` as its folder.

   The first time, Claude Code asks you to trust the folder. Say yes: that's what lets the
   folder's `.claude/settings.json` turn the plugin on.

3. **Check it's on:** run `/safe-context:status`. Then work through `~/macrohard/TRY-THESE.md`.

Each persona keeps its own chat history and project memory. Your personal settings and your own
`~/.claude/CLAUDE.md` still apply, as they do in every folder.

### How the plugin gets turned on

Each persona folder has a `.claude/settings.json` like this:

```json
{
	"extraKnownMarketplaces": {
		"safecontext": { "source": { "source": "directory", "path": "/path/to/this/repo" } }
	},
	"enabledPlugins": { "safe-context@safecontext": true }
}
```

It registers this repo as a plugin marketplace (`.claude-plugin/marketplace.json`, which lists
`./plugin`) and enables Safe Context for that folder only. Claude Code reads the plugin straight
from the repo, so a change to `plugin/` takes effect in the next session. A company would
roll it out the same way, but through managed settings rather than a file in each folder.

## Watch it on the dashboard

The dashboard's Overview page shows a live feed of checks: the hook (prompt, tool input or tool
output), the tool, whether it was blocked, how long it took, and how many items of each data
type were found. It never shows the text itself, which never leaves the Mac.

The database must be set up first (see the main README, "Dashboard and sync").

1. **Start the dashboard:** `pnpm --filter @safecontext/dashboard dev`, then open
   http://localhost:5173.
2. **Get an enrollment key** (the first time only):
   `pnpm --filter @safecontext/dashboard enrollment-key`. It prints a key once.
3. **Start the agent pointed at the dashboard** instead of step 1 above:

   ```bash
   SC_DASHBOARD_URL=http://localhost:5173 SC_ENROLLMENT_KEY=<key> demo/start-agent.sh
   ```

   Look for `device_registered` and `policy_synced` (policy version 1, with the word lists). The
   agent keeps its device token in the Keychain, so later you can leave out `SC_ENROLLMENT_KEY`.

Checks then appear in the live feed within a few seconds. Without the dashboard, the agent uses
the built-in default policy, which has no word lists, so the Project Atlas and Northwind
examples are only caught where tier 1 spots them.

There's no policy editor yet (#23), so the policy can't be changed from the dashboard.

## Check the scenarios automatically

With the agent running (and synced to the dashboard, so it has the word lists):

```bash
node demo/check.ts            # every scenario in demo/scenarios.ts, against 127.0.0.1:4747
node demo/check.ts --verbose  # also print what Claude would see
```

`demo/scenarios.ts` is the source for both this check and `TRY-THESE.md`. Rows with a `gap` are
places where Safe Context falls short today; their `expect` is today's behaviour, so a fix
shows up as a changed result.
