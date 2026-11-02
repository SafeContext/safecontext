# installer

Packaging for the local agent on macOS (Apple Silicon). See SPEC.md §2b and §7 item 5.

Planned contents: Homebrew formula, launchd plist (runs the agent in the background),
first-run model download. Nothing here yet: issue #26, which also holds the packaging decision.

What the installer will need to set up, from the merged agent work:

- `SC_TIER1_MODEL_DIR`: an absolute path to the downloaded tier 1 model (PR #67). The model is
  pinned in `ml/models.lock.json` and hosted on the private Hugging Face org (#70).
- `SC_DASHBOARD_URL` and `SC_ENROLLMENT_KEY`, for example from MDM (PR #53). How devices join an
  organisation is still open: #51.
- The "how to fix" text in `plugin/scripts/agent-status.sh` still says to run the agent with
  `pnpm`. Change it once #26 decides how the agent starts.
