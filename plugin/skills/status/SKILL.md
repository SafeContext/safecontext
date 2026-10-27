---
name: status
description: Show whether the Safe Context agent is running and which policy version it enforces.
disable-model-invocation: true
allowed-tools: Bash(sh ${CLAUDE_PLUGIN_ROOT}/scripts/agent-status.sh)
---

## Safe Context status

!`sh ${CLAUDE_PLUGIN_ROOT}/scripts/agent-status.sh`

Tell the user the status above in one or two short sentences, keeping its wording. If it says how
to fix a problem, include those steps. Don't run any commands or tools.
