#!/bin/sh
# Is the local Safe Context agent running? Asks its GET /health endpoint (SPEC.md §3).
#
#   agent-status.sh                  Status in plain words, for /safe-context:status. Always exits 0
#                                    (a non-zero exit would abort the skill).
#   agent-status.sh --session-start  SessionStart hook. When the agent is healthy, prints hook JSON
#                                    whose `additionalContext` tells Claude how Safe Context's
#                                    placeholders work (SPEC.md §4, issue #83). Otherwise prints hook
#                                    JSON whose `systemMessage` is shown to the user, with how to fix it.
#
# Port: SC_AGENT_PORT, the same variable the agent reads (default 4747, AGENT_DEFAULT_PORT in
# packages/policy). Only sh and curl are needed, so this works even when Node isn't installed.
# It never reads or prints prompt or tool text.

mode=status
[ "$1" = "--session-start" ] && mode=session-start

port="${SC_AGENT_PORT:-4747}"
case "$port" in
	'' | *[!0-9]*) state=bad-port ;;
	*)
		body=$(curl --silent --fail --max-time 2 "http://127.0.0.1:${port}/health" 2>/dev/null)
		if [ $? -ne 0 ]; then
			state=down
		else
			# Expected body: {"ok":true,"policyVersion":<n>}
			version=$(printf '%s' "$body" | sed -n 's/.*"policyVersion":\([0-9][0-9]*\).*/\1/p')
			case "$body" in
				*'"ok":true'*) [ -n "$version" ] && state=ok || state=unexpected ;;
				*'"ok":false'*) [ -n "$version" ] && state=unhealthy || state=unexpected ;;
				*) state=unexpected ;;
			esac
		fi
		;;
esac

# Not "run /safe-context:status": while the agent is down, Claude Code blocks that too (it is a
# prompt). Prompts work again as soon as the agent answers, with no restart.
fix="Start the Safe Context agent (developers: run \`pnpm --filter @safecontext/agent dev\` in the safecontext repo), then send your prompt again. If that doesn't help, contact your IT team."

case "$state" in
	ok) problem= ;;
	bad-port) problem="SC_AGENT_PORT must be a port number." ;;
	down) problem="the agent isn't running (nothing answered on 127.0.0.1:${port})." ;;
	unhealthy) problem="the agent on 127.0.0.1:${port} reports a problem." ;;
	*) problem="something on 127.0.0.1:${port} answered, but it isn't the Safe Context agent." ;;
esac

# For Claude, at the start of every session (and on resume and compaction). Fixed text with no
# quotes or backslashes, so it needs no JSON escaping.
context='Safe Context is on. It hides sensitive values in what you read behind placeholders such as ⟪customer_name_1⟫, or ⟪revenue_figure_1: over $4M⟫ where the text after the colon is a true hint. Each placeholder stands for one real value and stays the same for the whole session, so treat it as that value and copy it exactly, brackets included, whenever you need the value. In Read, Write, Edit, MultiEdit, NotebookEdit, Glob and Grep calls, file paths included, Safe Context puts the real value back just before the tool runs and hides it again in the result: files get the real value, you keep seeing the placeholder. Real values only go into files inside the project folder, not into hidden folders such as .git or .claude. Shell commands, web and MCP tools, and subagent prompts get the placeholder exactly as you wrote it, so use the file tools rather than the shell for files whose names or contents have placeholders. Do not try to guess or work out hidden values.'

if [ "$mode" = session-start ]; then
	if [ -z "$problem" ]; then
		printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"%s"}}\n' "$context"
		exit 0
	fi
	# Every value here is fixed text or digits, so it needs no JSON escaping.
	printf '{"systemMessage":"Safe Context: %s Until it is fixed, Claude Code blocks your prompts and tool calls. %s"}\n' "$problem" "$fix"
	exit 0
fi

if [ -z "$problem" ]; then
	echo "Safe Context: the agent is running on 127.0.0.1:${port}, enforcing policy version ${version}."
else
	echo "Safe Context: ${problem}"
	echo "Until it is fixed, Claude Code blocks your prompts and tool calls."
	echo "How to fix: ${fix}"
fi
exit 0
