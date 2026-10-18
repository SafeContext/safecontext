# Hook shapes: what Claude Code sends and what it accepts back

Result of the spike in issue #3. Everything here was observed in real `claude -p` runs, not
taken from the docs. Fixtures with the real (scrubbed) payloads are in
[`packages/policy/fixtures/hooks/`](../packages/policy/fixtures/hooks/).

- **Claude Code version tested:** `2.1.302` (macOS, Apple Silicon)
- **Model:** `haiku`, headless (`claude -p`), `http` hooks pointing at a throwaway local logger
- **Test data:** made-up "Macrohard" text in a temp folder. WebFetch fetched `https://example.com`
  and WebSearch ran one real search, so those two fixtures contain public web text.

## Verdict per tool

"Applied" means Claude saw the replacement text, checked in the `tool_result` that the run's
`stream-json` output recorded for the model. "Ignored" means Claude saw the original text.

| Tool | Field holding the text (`tool_response`) | `updatedToolOutput` rewrite |
| --- | --- | --- |
| Read | `file.content` | **Applied** when the whole object keeps its shape. A plain string is **ignored** (original shown). |
| Bash | `stdout` (and `stderr`) | **Applied** with the object shape. Plain string **ignored**. |
| Grep | `content` (mode `content`); `filenames` in file-list modes (not tested) | **Applied** with the object shape. Plain string **ignored**. |
| WebFetch | `result` | **Applied** with the object shape. Plain string **ignored**. |
| WebSearch | the string items in `results`, plus each `results[].content[].title` | **Applied** with the object shape. Plain string **ignored**. |
| MCP (`mcp__<server>__<tool>`) | `[].text` (array of content blocks) | **Applied**, both with the array shape and with a plain string (no shape validation for MCP). |

Rule of thumb: copy the original `tool_response`, change only the text fields, and send the
whole object back. A value of the wrong shape is dropped without any error, and the raw text
reaches Claude. The agent should check the shape of what it returns, per tool.

## Per-tool detail

Every `PostToolUse` input also has `session_id`, `transcript_path`, `cwd`, `scratchpad_dir`,
`prompt_id`, `permission_mode`, `effort`, `hook_event_name`, `tool_name`, `tool_input`,
`tool_response`, `tool_use_id` and `duration_ms`. The `PreToolUse` input is the same without
`tool_response` and `duration_ms`. `packages/policy/src/hooks.ts` already accepts all of these
(inputs are loose).

### Read

- `tool_input`: `{ "file_path": "..." }` (absolute path).
- `tool_response`: `{ "type": "text", "file": { "filePath", "content", "numLines", "startLine", "totalLines" } }`.
- Text is `file.content`. It has no line numbers in the hook; Claude Code adds the `1<tab>` line
  numbers itself after our replacement, so don't add them.
- Images, PDFs and notebooks were not tested and probably have a different `type`.

### Bash

- `tool_input`: `{ "command", "description" }` (plus `timeout`, `run_in_background` when set).
- `tool_response`: `{ "stdout", "stderr", "interrupted", "isImage", "noOutputExpected" }`.
- Clean both `stdout` and `stderr`. Only `stdout` was replaced in the test.

### Grep

- `tool_input`: `{ "pattern", "path", "output_mode", "-n" }` and any other options Claude chose.
- `tool_response`: `{ "mode", "numFiles", "filenames", "content", "numLines", "totalLines" }`.
- In `content` mode the matches are in `content` and `filenames` is empty. In the other modes
  (`files_with_matches`, `count`) the text is probably in `filenames`; **not tested**. File paths
  can themselves be sensitive.

### WebFetch

- `tool_input`: `{ "url", "prompt" }`. Both can carry data out, so `PreToolUse` should check them.
- `tool_response`: `{ "bytes", "code", "codeText", "result", "durationMs", "url" }`.
- `result` is not the raw page. Claude Code has already run the page through a small model with
  the `prompt`, and `result` is that answer.
- `http://` URLs are upgraded to `https://`, so a plain-HTTP localhost page fails with an SSL
  error. This blocks testing against a local web server.

### WebSearch

- `tool_input`: `{ "query", "mode" }`.
- `tool_response`: `{ "query", "results", "durationSeconds", "searchCount" }`.
- `results` is a **mixed array**: objects `{ "tool_use_id", "content": [{ "title", "url" }, ...] }`
  followed by plain strings (a written summary of the results). Clean the strings and the
  `title`s. The `url`s were left alone in the test and still reached Claude; URLs can carry data.
- `tool_use_id` inside `results` is a server-side id (`srvtoolu_...`), not the hook's `tool_use_id`.

### MCP tool

- Tool name: `mcp__<server>__<tool>`. The test used a tiny local stdio server, so the matcher
  needs to cover `mcp__.*`.
- The input has an extra `mcp_server: { "name", "source" }`.
- `tool_input` is the tool's own arguments, for example `{ "name": "Contoso Widgets" }`.
- `tool_response` is the array of MCP content blocks: `[{ "type": "text", "text": "..." }]`.
  Image or resource blocks, and servers that return `structuredContent`, were not tested.
- `updatedToolOutput` is not validated for MCP, so any value is accepted. Keep the array shape
  anyway so Claude sees the same structure it normally would.

## Hook round-trip latency (`http` hook, localhost)

Measured from Claude Code's debug log, between "HTTP hook POST" and "response", for 24 hook
calls (12 `PreToolUse`, 12 `PostToolUse`) against a logger that does almost no work (under 0.5 ms
of handler time).

| min | median | p95 | max |
| --- | --- | --- | --- |
| 1 ms | 2 ms | 6 ms | 11 ms |

Timestamps have 1 ms resolution. This is the fixed cost of the transport only; the classifier time
is on top. The transport is no obstacle to the 300 ms target for tiers 0 and 1.

## Gotchas

1. **A wrong shape is silent.** For built-in tools a plain string, or an object with a different
   shape, is ignored and the original output is used. Test each tool's replacement in the agent.
2. **Failed tool calls skip `PostToolUse`.** A WebFetch that errored produced `PreToolUse` but no
   `PostToolUse`. Claude Code fires `PostToolUseFailure` instead, which can't rewrite the error text
   (per the docs). Tracked in issue [#44](https://github.com/SafeContext/safecontext/issues/44).
3. **`ToolSearch` is a tool too.** In one run Claude called `ToolSearch` to load deferred tools, and
   both hooks fired for it. The matcher should not assume only the six tools.
4. **Line numbers on Read** are added by Claude Code after our replacement (see Read above).
5. **Extra fields** such as `transcript_path`, `scratchpad_dir`, `prompt_id` and `effort` exist in
   every input. They contain local paths, so the agent must never log or send them to the dashboard.

## Do the real shapes match `hooks.ts`?

Yes. Every fixture parses with `PreToolUseInput` and `PostToolUseInput`, and every replacement
parses with `PostToolUseOutput` (`fixtures.test.ts` checks this). No change to `packages/policy/src`
was needed. The one gap is that there is no type for `PostToolUseFailure` (issue #44).

## Not tested (to keep token use low)

- Grep modes other than `content`; Read of images, PDFs and notebooks; very large outputs.
- Subagent tool calls and `@file` mentions (issues #4 and #38).
- Edit, Write and the other built-in tools.
- Whether the session transcript on disk keeps the original text (the docs say telemetry does).

## How the runs were done

A small Node logger on `127.0.0.1:4801` accepted `POST /pre` and `POST /post`, wrote each body to
a file, and (in rewrite mode) returned an `updatedToolOutput` with the text fields replaced by a
marker string. Hooks were loaded with `claude -p --settings <file> --setting-sources local`, so
nothing in `~/.claude` was changed and no plugin was installed. Three complete sessions (plus two aborted attempts that logged nothing useful), one prompt that
uses all six tools: observe only, rewrite with the correct shape, rewrite with a plain string.
