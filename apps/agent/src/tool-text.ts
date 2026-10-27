/**
 * Where the text is in each tool's input and output, and how to replace it without changing the
 * shape. Shapes come from real Claude Code runs: docs/hook-shapes.md and
 * packages/policy/fixtures/hooks/.
 *
 * Claude Code silently IGNORES an `updatedToolOutput` whose shape doesn't match the tool's
 * (the raw output gets through), so replacement only ever swaps strings for strings and
 * returns a copy with every other value untouched.
 *
 * `toolOutputTexts` and `mapToolOutputText` walk the same fields in the same order, so index
 * `i` in one is index `i` in the other. Issue #10 builds its rewriting on that.
 */

/** Gets each text and its index (in `toolOutputTexts` order); returns the replacement. */
export type TextMapper = (text: string, index: number) => string;

type Shape = {
	/** True if `response` has the shape we know for this tool. Otherwise all strings are checked. */
	matches(response: unknown): boolean;
	map(response: unknown, fn: (text: string) => string): unknown;
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const mapIfString = (v: unknown, fn: (text: string) => string): unknown => (typeof v === 'string' ? fn(v) : v);

const SHAPES: Record<string, Shape> = {
	// { type: "text", file: { filePath, content, numLines, startLine, totalLines } }
	Read: {
		matches: (r) => isObject(r) && r.type === 'text' && isObject(r.file) && typeof r.file.content === 'string',
		map: (r, fn) => {
			const o = r as Record<string, Record<string, unknown>>;
			return { ...o, file: { ...o.file, content: fn(o.file!.content as string) } };
		}
	},
	// { stdout, stderr, interrupted, isImage, noOutputExpected }
	Bash: {
		matches: (r) => isObject(r) && typeof r.stdout === 'string',
		map: (r, fn) => {
			const o = r as Record<string, unknown>;
			return { ...o, stdout: fn(o.stdout as string), stderr: mapIfString(o.stderr, fn) };
		}
	},
	// { mode, numFiles, filenames: string[], content, numLines, totalLines }. File paths can be sensitive too.
	Grep: {
		matches: (r) => isObject(r) && (typeof r.content === 'string' || Array.isArray(r.filenames)),
		map: (r, fn) => {
			const o = r as Record<string, unknown>;
			return {
				...o,
				...('content' in o && { content: mapIfString(o.content, fn) }),
				...(Array.isArray(o.filenames) && { filenames: o.filenames.map((f) => mapIfString(f, fn)) })
			};
		}
	},
	// { bytes, code, codeText, result, durationMs, url }. `result` is already a model's answer about the page.
	WebFetch: {
		matches: (r) => isObject(r) && typeof r.result === 'string',
		map: (r, fn) => ({ ...(r as object), result: fn((r as { result: string }).result) })
	},
	// { query, results: [ { tool_use_id, content: [{ title, url }] } | string ], durationSeconds, searchCount }
	WebSearch: {
		matches: (r) => isObject(r) && Array.isArray(r.results),
		map: (r, fn) => {
			const o = r as { results: unknown[] };
			return {
				...o,
				results: o.results.map((item) => {
					if (typeof item === 'string') return fn(item);
					if (!isObject(item) || !Array.isArray(item.content)) return item;
					return {
						...item,
						content: item.content.map((hit) =>
							isObject(hit) ? { ...hit, title: mapIfString(hit.title, fn), url: mapIfString(hit.url, fn) } : hit
						)
					};
				})
			};
		}
	}
};

// MCP tools (`mcp__<server>__<tool>`): an array of content blocks, `[{ type: "text", text }]`.
// Claude Code doesn't validate MCP replacements, but we keep the shape anyway.
// Image and resource blocks are left alone (untested, see docs/hook-shapes.md).
const MCP: Shape = {
	matches: (r) => Array.isArray(r) || typeof r === 'string',
	map: (r, fn) =>
		typeof r === 'string'
			? fn(r)
			: (r as unknown[]).map((block) =>
					isObject(block) && block.type === 'text' && typeof block.text === 'string'
						? { ...block, text: fn(block.text) }
						: block
				)
};

function shapeFor(toolName: string, response: unknown): Shape | undefined {
	const shape = toolName.startsWith('mcp__') ? MCP : SHAPES[toolName];
	return shape?.matches(response) ? shape : undefined;
}

/**
 * Copy of `value` with every string replaced by `fn`, at any depth. Used for tool inputs, and for
 * tool outputs whose shape we don't know (other tools, or a known tool with an unexpected shape),
 * so nothing goes unchecked.
 */
export function mapAllStrings(value: unknown, fn: (text: string) => string): unknown {
	if (typeof value === 'string') return fn(value);
	if (Array.isArray(value)) return value.map((v) => mapAllStrings(v, fn));
	if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapAllStrings(v, fn)]));
	return value;
}

/** Copy of a tool's output with each text field replaced by `fn`. Same shape as the input. */
export function mapToolOutputText(toolName: string, response: unknown, fn: TextMapper): unknown {
	let i = 0;
	const each = (text: string) => fn(text, i++);
	const shape = shapeFor(toolName, response);
	return shape ? shape.map(response, each) : mapAllStrings(response, each);
}

/** The text fields of a tool's output, in a stable order. */
export function toolOutputTexts(toolName: string, response: unknown): string[] {
	const texts: string[] = [];
	mapToolOutputText(toolName, response, (text) => (texts.push(text), text));
	return texts;
}

/** Every string in a tool's input (commands, URLs, prompts, MCP arguments, paths). */
export function toolInputTexts(toolInput: Record<string, unknown>): string[] {
	const texts: string[] = [];
	mapAllStrings(toolInput, (text) => (texts.push(text), text));
	return texts;
}
