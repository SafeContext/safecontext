# installer

Packaging for the Safe Context agent on macOS (Apple Silicon), issue #26. SPEC.md §7 item 5 has
the decisions.

```bash
pnpm models:pull                                   # the tier 1 model the package includes
pnpm --filter @safecontext/installer build         # → installer/dist/
```

`build.ts` writes:

- `dist/SafeContext-<version>.pkg`: for Jamf, Kandji and other device management tools.
- `dist/safecontext-<version>-darwin-arm64.tar.gz` and `dist/safecontext.rb`: the Homebrew
  formula with that file's checksum. Not published: it goes in a tap repo
  (`SafeContext/homebrew-tap`) and the tarball on a GitHub release when Joe decides.

Options: `--version 1.2.3` (default: this package's version), `--node <path>` (default: the Node.js
24 running the build). The build checks the tier 1 model against `ml/models.lock.json`.

## What gets installed

| Where | What |
| --- | --- |
| `/Library/Application Support/SafeContext/bin/` | `node` (24), `safecontext` (the command), `sc-extract` |
| `/Library/Application Support/SafeContext/lib/` | the agent bundled into `agent.mjs` and `cli.mjs`, ONNX Runtime |
| `/Library/Application Support/SafeContext/models/tier1/` | the tier 1 model (about 600 MB) |
| `/Library/Application Support/SafeContext/prompts/tier2/` | tier 2 prompt files |
| `/Library/LaunchAgents/com.safecontext.agent.plist` | runs `safecontext run` for each person at login, restarts it if it stops |
| `/usr/local/bin/safecontext` | link to the command |

Per person: `~/Library/Application Support/SafeContext/` (policy copy, encrypted placeholder keys,
swap record), `~/Library/Logs/SafeContext/agent.log` (metadata only), and Keychain items under
`com.safecontext.agent`.

## Settings

From an MDM configuration profile, preference domain `com.safecontext.agent`. The dashboard's
Deploy page builds one (`agentProfile` in `packages/policy`). Keys:

| Key | Setting |
| --- | --- |
| `DashboardURL` | `SC_DASHBOARD_URL` |
| `EnrollmentKey` | `SC_ENROLLMENT_KEY` |
| `DeviceLabel` | `SC_DEVICE_LABEL` (e.g. Jamf's `$SERIALNUMBER`) |
| `ModelServerURL`, `ModelServerKey`, `ModelServerModel` | the company's tier 2 server (#75) |
| `LocalModelFallback` (boolean), `LocalModel` | this Mac's model as the fallback |
| `CheckBudgetMs` (integer) | `SC_CHECK_BUDGET_MS` |

Order: the managed profile, then environment variables, then
`/Library/Preferences/com.safecontext.agent.plist` (Macs without MDM, same keys), then the
installed defaults (`apps/agent/src/install/settings.ts`). Tier 2 is on by default and uses Ollama
on the Mac when there's no model server; without either its spans simply stay flagged.

## Signing and notarizing

Unsigned until these are set (Joe's Apple Developer ID):

- `SC_SIGN_APP="Developer ID Application: …"`: signs `node`, the ONNX add-on and `sc-extract` with
  the hardened runtime (`entitlements.plist`: JIT and loading the add-on).
- `SC_SIGN_INSTALLER="Developer ID Installer: …"`: signs the `.pkg`.
- `SC_NOTARY_PROFILE=<profile>` (from `xcrun notarytool store-credentials`): notarizes and staples it.

## Removing it

`sudo "/Library/Application Support/SafeContext/uninstall.sh"` stops the agent for everyone and
removes the files. `--purge` also deletes each person's saved keys, swap record, logs and Keychain
items. Homebrew: `brew services stop safecontext && brew uninstall safecontext`.
