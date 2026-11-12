# Demo: MacroHard

To try Safe Context by hand, use the **[SafeContext/MacroHard](https://github.com/SafeContext/MacroHard)**
repo (private). It's a made-up company with three people, each with a folder of realistic work
files:

- **James May**, backend engineer: `James-May-Dev`
- **Richard Hammond**, product manager: `Richard-Hammond-PM`
- **Jeremy Clarkson**, enterprise sales: `Jeremy-Clarkson-Sales`

Open a person's folder in Claude Code, from the terminal or the desktop app, and Safe Context is
on. Open any other folder and it's off. MacroHard's README covers setup and use, and its
`TRY-THESE.md` lists what to try and what should happen.

This folder holds the parts that belong with Safe Context's code:

| File | What it does |
| --- | --- |
| `start-agent.sh` | Starts the agent with tiers 0, 1 and 2, and Ollama if it isn't running |
| `scenarios.ts` | What each MacroHard person might type or have Claude read, and what Safe Context should do |
| `check.ts` | Sends every scenario through a running agent and reports any that don't match; `--list` prints MacroHard's `TRY-THESE.md` |

The repo root also has `.claude-plugin/marketplace.json`, which lists `plugin/` as a plugin
marketplace (a catalogue Claude Code installs plugins from). MacroHard's folders point at it
on GitHub, so it must be on `main` for them to load the plugin.

## Start the agent

```bash
demo/start-agent.sh
```

Wait for `tier1_ready` and `tier2_ready`. Ctrl-C stops the agent, and Ollama too if the script
started it. In a git worktree, which has no models of its own, point it at the main checkout's
model: `SC_TIER1_MODEL_DIR=/path/to/safecontext/ml/models/tier1-onnx demo/start-agent.sh`.

## Watch it on the dashboard

The dashboard's Overview page shows a live feed of checks: the hook (prompt, tool input or tool
output), the tool, whether it was blocked, how long it took, and how many items of each data
type were found. It never shows the text itself, which never leaves the Mac.

Set the database up first (main README, "Dashboard and sync"). Then:

1. **Start the dashboard:** `pnpm --filter @safecontext/dashboard dev`, then open
   http://localhost:5173 and sign in as the demo admin (email and password in
   `apps/dashboard/prisma/demo-admin.ts`; run `db:seed` first if it says they don't match).
2. **Get an enrollment key**, the first time only: `pnpm --filter @safecontext/dashboard enrollment-key`.
   It prints a key once. Running it again replaces the key.
3. **Start the agent pointed at the dashboard:**

   ```bash
   SC_DASHBOARD_URL=http://localhost:5173 SC_ENROLLMENT_KEY=<key> demo/start-agent.sh
   ```

   Look for `device_registered`, then `policy_synced` with policy version 1, which has the word
   lists. The agent keeps its device token in the Keychain, so later you can leave out
   `SC_ENROLLMENT_KEY`.

Checks appear in the live feed within a few seconds. Without the dashboard, the agent uses the
built-in default policy, which has no word lists: Project Atlas and Northwind are then only
caught where tier 1 spots them, and some scenarios give a different result.

To change the policy, use the dashboard's Policy page (#23) and click Publish; the agent picks it
up within 30 seconds. If you change what the demo personas rely on (the word lists, or the columns
of customer names, roadmap and secrets), some checks in `demo/check.ts` will give different results.

## Check the scenarios

With MacroHard cloned to `~/github/MacroHard` (after its `./setup.sh`) and the agent running
with the demo policy:

```bash
node demo/check.ts            # or --dir /path/to/MacroHard, --port 4799
node demo/check.ts --verbose  # also print what Claude would see
```

Rows with a `gap` mark places where Safe Context falls short today. Their `expect` is today's
behaviour, so a fix shows up as a changed result. After changing `scenarios.ts`, refresh
MacroHard's guide with `node demo/check.ts --list > ~/github/MacroHard/TRY-THESE.md` and commit
it there.
