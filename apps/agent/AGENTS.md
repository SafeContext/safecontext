# Agent (Hono)

Rules for `apps/agent`. The repo-wide rules are in the root `AGENTS.md`.

- Endpoints, request and response bodies: SPEC.md §3. Validate every request and response with
  the schemas in `packages/policy`.
- Keep hook responses within Claude Code's timeouts (`UserPromptSubmit`: 30 s; aim far lower).
- Tier 2 reads its prompts from `ml/prompts/tier2/`, the files `ml/` scores. Don't copy them into
  the agent. After changing one, rerun `python3 apps/agent/scripts/tier2-render-fixture.py`.
- Real-model tests are opt-in (`SC_TIER1_MODEL_DIR`, `SC_TIER2_REAL=1`). CI has no models, so it
  runs the mocked tests only.
  The agent's own budget per check is `SC_CHECK_BUDGET_MS` (default 8 s); past it, the fail mode applies.
- Logs and dashboard events hold metadata only. Tests check that no prompt or tool text reaches them.
