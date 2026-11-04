#!/bin/sh
# Starts Safe Context's agent for the demo personas, with tiers 0, 1 and 2, on port 4747.
# If Ollama (tier 2) isn't running, starts it too and stops it again when you press Ctrl-C.
#
#   demo/start-agent.sh
#
# To send checks to a local dashboard as well (see demo/README.md):
#   SC_DASHBOARD_URL=http://localhost:5173 SC_ENROLLMENT_KEY=<key> demo/start-agent.sh
# The enrollment key is only needed the first time; the agent keeps its device token in the Keychain.
set -eu

REPO=$(cd "$(dirname "$0")/.." && pwd)
cd "$REPO"

# Node 24 from .nvmrc, if nvm is installed.
if [ -s "$HOME/.nvm/nvm.sh" ]; then
	# shellcheck disable=SC1091
	. "$HOME/.nvm/nvm.sh"
	nvm use --silent >/dev/null
fi

# The tier 1 model. Set SC_TIER1_MODEL_DIR to use one elsewhere (e.g. from a git worktree,
# which has no models of its own).
SC_TIER1_MODEL_DIR="${SC_TIER1_MODEL_DIR:-$REPO/ml/models/tier1-onnx}"
if [ ! -f "$SC_TIER1_MODEL_DIR/model.onnx" ]; then
	echo "No tier 1 model in $SC_TIER1_MODEL_DIR. Run 'pnpm models:pull' in $REPO first." >&2
	exit 1
fi

if ! curl -s -m 1 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
	if ! command -v ollama >/dev/null 2>&1; then
		echo "Ollama isn't installed, so tier 2 will be unavailable. Install it with 'brew install ollama'." >&2
	else
		LOG="${TMPDIR:-/tmp}/safecontext-ollama.log"
		OLLAMA_CONTEXT_LENGTH=8192 OLLAMA_FLASH_ATTENTION=1 ollama serve >"$LOG" 2>&1 &
		OLLAMA_PID=$!
		trap 'kill "$OLLAMA_PID" 2>/dev/null || true' EXIT INT TERM
		echo "Started Ollama (log: $LOG)"
		i=0
		until curl -s -m 1 http://127.0.0.1:11434/api/version >/dev/null 2>&1; do
			i=$((i + 1))
			[ "$i" -ge 20 ] && { echo "Ollama didn't start; see $LOG" >&2; break; }
			sleep 0.5
		done
	fi
fi

export SC_TIER1_MODEL_DIR
export SC_TIER2_MODEL="${SC_TIER2_MODEL:-gemma4:e4b-it-q4_K_M}"

echo "Starting the agent on http://127.0.0.1:${SC_AGENT_PORT:-4747}. Wait for tier1_ready and tier2_ready. Ctrl-C stops it."
pnpm --filter @safecontext/agent dev
