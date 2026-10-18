# Hook coverage: what bypasses the hooks?

Spike for issue #4. Question: can company data reach Claude without passing through the Safe
Context hooks (SPEC.md §2 and §6.2)?

- **Claude Code version tested:** `2.1.302` (macOS, Apple Silicon), 18 Oct 2026
- **Model for the runs:** `haiku`, except where noted
- **Docs checked:** https://code.claude.com/docs/en/hooks

## Summary

| Case | Result | Follow-up |
| --- | --- | --- |
| `@file` mentions | **Not covered** (by default). Possible fix tested | #38 |
| CLAUDE.md, rules and imported memory files | **Not covered** (observe-only hook exists) | #39 |
| Images and PDFs read by Claude | **Hooks fire, but nothing to check.** Partly covered | #40 |
| Subagent tool calls | **Covered.** The result passed back to Claude is not | #41 |
| Pasted content | **Covered** (tested in `-p` mode only; interactive paste not tested) | none |
| Slash commands and skills | **Not covered** | #42 |
| Other tools outside our matcher | **Not covered** | #41 |

"Covered" means the hook fired and its input contained the data. It does not mean cleaning
works: that depends on the output shapes in issue #3.

## How it was tested

- A throwaway logger on `127.0.0.1:4802` received every hook call as `type: "http"` hooks, the same
  mechanism the plugin uses. It was loaded only for the test runs with `claude --settings <file>`.
  Nothing was installed, and `~/.claude` was not edited.
- The logger wrote down which hook fired and which fields were present (names, types, lengths),
  plus the IDs of made-up marker strings such as `MH-CANARY-ATFILE-1` found in the payload. It never wrote the text.
- All files were fake "Macrohard" files in a temporary folder: a CLAUDE.md, an imported note, a rules
  file, a nested CLAUDE.md, text notes, a PNG with a marker drawn on it, a PDF, and a skill.
- Each run was `claude -p ... --model haiku --output-format stream-json --verbose`. To see whether
  Claude actually received the data, the prompt asked it to report the markers it could see. A
  marker in Claude's reply but in no hook payload means the data got past the hooks.
- The logger also denied any `Read` of a file named `deny-*`, to prove hooks can block inside subagents.
- The tool hooks were set with no matcher, so every tool call was logged. "Our matcher" below means the one in `plugin/hooks/hooks.json`:
  `Read|Bash|Grep|WebFetch|WebSearch|mcp__.*`.

Side effect: Claude Code loads the user-level `~/.claude/CLAUDE.md` of the Mac running the test into
every run (it showed up as one `InstructionsLoaded` event with `memory_type: "User"`). The logger
recorded only that the file was outside the test folder. Nothing from it was written down.

## Results by case

### `@file` mentions: not covered

`claude -p "Using only @notes/launch.txt, quote the launch budget code"`.

- Claude answered with the marker from the file, so it received the contents.
- The only hook that fired was `UserPromptSubmit`, and its `prompt` held just the typed text:
  no file contents, no marker. No `PreToolUse` or `PostToolUse` fired, not even for `Read`.
- This matches the docs: Claude Code inserts @-mentioned files while building the prompt, with no tool call.

**Possible fix (tested):** set `CLAUDE_CODE_DISABLE_FILE_MENTIONS=1`. Re-run: Claude read the file
with `Read`, and `PreToolUse` and `PostToolUse` both fired with the marker in the result. Notes from
the docs: needs Claude Code **2.1.299+**, and it is ignored in project and local settings, so it must
go in managed settings or user settings. Not tested: whether a plugin can set it. Alternative: a
`Read` deny rule for specific paths blocks them in @ mentions too (docs only, not tested).

### CLAUDE.md and memory files: not covered

Fake CLAUDE.md with an `@docs/imported.md` import, `.claude/rules/rule.md`, and `sub/CLAUDE.md`.

- Claude reported all of the markers (CLAUDE.md, imported file, rule). After reading `sub/data.txt`
  it also reported the nested CLAUDE.md's marker.
- No marker appeared in any `UserPromptSubmit`, `PreToolUse` or `PostToolUse` payload.
- The `InstructionsLoaded` hook fired for each file: `session_start` for CLAUDE.md and the rule,
  `include` for the import (with `parent_file_path`), and `nested_traversal` for the nested file when
  Claude read in that folder (with `trigger_file_path`). It carries only the file path and metadata, never the contents.
- By the docs, it cannot block or change anything. It is for logging.

**Possible fix:** the agent can read the file at `file_path` and warn the user (warn-only, no
redaction). Anything stronger is a product decision. See #39.

### Images and PDFs: hooks fire, nothing to check

Fake PNG (marker drawn as text) and fake PDF (marker in the text layer), both read with `Read`.

- Claude reported both markers.
- `PreToolUse` and `PostToolUse` fired for both. `tool_response` was a `base64` string (about 16 and 18 KB),
  not text, so neither marker appeared in the payload. A text classifier sees nothing to check.
- `updatedToolOutput` for an image or PDF result is untested (relates to issue #3).

**Possible fix:** `PreToolUse` can deny by file type (fails closed). Or the agent runs OCR/text
extraction first. See #40. Not tested: images pasted into a prompt (needs an interactive session).

### Subagent tool calls: covered

Prompt asked an `Explore` subagent to read two fake files, one named `deny-me.txt`.

- `PreToolUse` and `PostToolUse` fired for the subagent's `Read` calls. The input carries `agent_id` and
  `agent_type: "Explore"`. The marker was in the `PostToolUse` payload.
- The logger's `permissionDecision: "deny"` on `deny-me.txt` worked inside the subagent: it got a hook error and could not read the file.
- `SubagentStart` and `SubagentStop` fired too. `SubagentStop` carries `last_assistant_message`.
- Gap: the subagent's report goes back to Claude as the `Agent` tool result. `Agent` is not in our
  matcher, so that text is not checked. It is normally derived from data the subagent read through the
  hooks, but that was not checked for other sources (for example memory files).
- Not tested: that `updatedToolOutput` is applied inside a subagent. Only firing and deny were proven.

See #41.

### Pasted content: covered (limited test)

`-p` mode has no real paste, so a multi-line prompt with a marker on line 2 was used instead.

- `UserPromptSubmit` received the whole prompt and the marker was in it.
- The docs say pasted text that collapses to `[Pasted text #N]` arrives expanded in the `prompt` field.
  It may be wrapped in `<pasted_content id="…">` lines, which the agent's parser must tolerate.
- **Not tested:** a real paste in the interactive app. No terminal multiplexer was available, and
  accepting the folder trust dialog would have written to the user's `~/.claude.json`. A human should
  paste a fake log into an interactive session with the logger loaded and check `prompt`. Pasted images are untested.

### Slash commands and skills: not covered

Fake skill `macro-brief` containing a marker in its text and a `` !`cat notes/inject.txt` `` line with another marker.

- Typing `/macro-brief arg1`: Claude reported both markers.
- `UserPromptSubmit` got only the typed line. `UserPromptExpansion` fired with `command_name`, `command_args`,
  `expansion_type`, `command_source` and `prompt` (the typed line too). Neither held the skill text or the injected file contents.
- `PreToolUse` and `PostToolUse` did not fire for the `cat` the skill ran, so injected shell output bypasses them.
- When Claude calls the skill itself, `PreToolUse` and `PostToolUse` fire for the `Skill` tool (not in our
  matcher), but `tool_response` is only `success`, `commandName` and `allowedTools`: no text.
- `UserPromptExpansion` can block a command, so an allow-list is possible. Not tested: MCP prompts.

See #42.

### Other tools outside our matcher

One run with `Glob`, `Edit`, `Write`:

- `Glob` result: file names only, shown to Claude. Not in our matcher.
- `Edit` and `Write`: Claude only got a short success message, so little exposure.
- Not tested: `PowerShell`, `Workflow`, and the other tools in the docs list.

See #41.

## What was not tested

- Real pasting in an interactive session, including pasted images.
- `updatedToolOutput` inside subagents, and for images and PDFs.
- Whether a plugin can set `CLAUDE_CODE_DISABLE_FILE_MENTIONS`.
- MCP prompts and `@server:resource` mentions.
- Background subagents and scheduled tasks (the docs say `UserPromptSubmit` also fires for them).
- Other models, platforms and Claude Code versions.
