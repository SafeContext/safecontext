/**
 * Tier 2 prompt files and chat requests (issue #16). A port of
 * `ml/src/safecontext_ml/tier2/prompts.py`: the agent loads the same files from
 * `ml/prompts/tier2/` (`SC_TIER2_PROMPTS_DIR`) and renders them the same way, so what the
 * evaluation scored is what the agent sends. `prompts.test.ts` checks the rendering against a
 * fixture written by the Python reference.
 *
 * Per task directory (`context/`, `generalize/`): `system.md`, `user.md` (template with
 * `{{data_types}}`, `{{document}}`, `{{spans}}`), `schema.json` (answer JSON Schema) and
 * `examples.json` (few-shot turns). `tier2.json` holds the version, labels, excerpt sizes and
 * timeouts.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type TaskName = 'context' | 'generalize';
export const TASKS: readonly TaskName[] = ['context', 'generalize'];
/** Marker prefix per task: <s1>...</s1> for spans to judge, <g1>...</g1> for values to rewrite. */
const PREFIX: Record<TaskName, string> = { context: 's', generalize: 'g' };
/** The array in each task's answer. */
const ANSWER_ARRAY: Record<TaskName, string> = { context: 'spans', generalize: 'rewrites' };

export interface DataTypeInfo {
	id: string;
	name: string;
	description: string;
}

/** A span to send: offsets into the full text and its data type id. */
export interface SpanRef {
	start: number;
	end: number;
	dataTypeId: string;
}

export interface JsonSchema {
	title?: string;
	type?: 'object' | 'array' | 'string' | 'boolean' | 'integer' | 'number';
	properties?: Record<string, JsonSchema>;
	required?: string[];
	additionalProperties?: boolean;
	items?: JsonSchema;
	pattern?: string;
	minLength?: number;
	maxLength?: number;
	enum?: unknown[];
	[key: string]: unknown;
}

export interface Task {
	name: TaskName;
	prefix: string;
	system: string;
	userTemplate: string;
	schema: JsonSchema;
	maxTokens: number;
	/** Rendered few-shot turns (user/assistant pairs). */
	exampleTurns: ChatMessage[];
}

export interface ChatMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

export interface Manifest {
	version: number;
	tasks: {
		context: { dir: string; max_tokens: number; labels: string[] };
		generalize: { dir: string; max_tokens: number };
	};
	excerpts: { max_chars: number; context_chars: number };
	timeouts: { per_call_ms: number; min_budget_ms: number };
}

export interface Prompts {
	dir: string;
	manifest: Manifest;
	tasks: Record<TaskName, Task>;
}

interface ExamplesFile {
	data_types: Record<string, { name: string; description: string }>;
	examples: Array<{
		document: string;
		spans: Array<{ id: string; text: string; data_type: string }>;
		output: unknown;
	}>;
}

/** Load and check every prompt file. Throws if one is missing or malformed. */
export function loadPrompts(dir: string): Prompts {
	const json = (file: string): unknown => JSON.parse(readFileSync(join(dir, file), 'utf8'));
	const manifest = json('tier2.json') as Manifest;
	if (
		typeof manifest?.version !== 'number' ||
		!Array.isArray(manifest.tasks?.context?.labels) ||
		typeof manifest.timeouts?.per_call_ms !== 'number' ||
		typeof manifest.timeouts?.min_budget_ms !== 'number' ||
		typeof manifest.excerpts?.max_chars !== 'number' ||
		typeof manifest.excerpts?.context_chars !== 'number'
	) {
		throw new Error(`${join(dir, 'tier2.json')} is missing fields the agent needs`);
	}
	const load = (name: TaskName): Task => {
		const sub = manifest.tasks[name].dir;
		const text = (file: string) => readFileSync(join(dir, sub, file), 'utf8').trim();
		const ex = json(join(sub, 'examples.json')) as ExamplesFile;
		const task: Task = {
			name,
			prefix: PREFIX[name],
			system: text('system.md'),
			userTemplate: text('user.md'),
			schema: json(join(sub, 'schema.json')) as JsonSchema,
			maxTokens: manifest.tasks[name].max_tokens,
			exampleTurns: []
		};
		const types = new Map(Object.entries(ex.data_types).map(([id, t]) => [id, { id, ...t }]));
		task.exampleTurns = exampleTurns(task, ex, types);
		return task;
	};
	return { dir, manifest, tasks: { context: load('context'), generalize: load('generalize') } };
}

/**
 * `text` with `<{prefix}N>...</{prefix}N>` around each span, numbered 1.. in order. `spans`
 * must be sorted and must not overlap. `offset` is where `text` starts in the full text.
 */
export function mark(text: string, spans: readonly SpanRef[], prefix: string, offset = 0): string {
	let out = '';
	let pos = 0;
	spans.forEach((s, i) => {
		const a = s.start - offset;
		const b = s.end - offset;
		if (a < pos || b > text.length || a >= b) throw new Error('span overlaps another or is outside the text');
		out += `${text.slice(pos, a)}<${prefix}${i + 1}>${text.slice(a, b)}</${prefix}${i + 1}>`;
		pos = b;
	});
	return out + text.slice(pos);
}

const PLACEHOLDER = /\{\{(data_types|document|spans)\}\}/g;

/**
 * The user message. `spans` = [id, span text, data type id], in document order. Line formats
 * (the same as the Python):
 * - data types: `- <id> (<name>): <description>`, one per data type used, in order of first use
 * - spans: `- <id>: "<span text>" (<data type id>)`, the span text as a JSON string
 */
export function renderUser(
	task: Pick<Task, 'userTemplate'>,
	markedDocument: string,
	spans: ReadonlyArray<readonly [string, string, string]>,
	dataTypes: ReadonlyMap<string, DataTypeInfo>
): string {
	const used: string[] = [];
	for (const [, , dt] of spans) if (!used.includes(dt)) used.push(dt);
	const typeLines = used.map((dt) => {
		const info = dataTypes.get(dt) ?? { id: dt, name: dt, description: '' };
		return `- ${info.id} (${info.name}): ${info.description}`.replace(/[: ]+$/, '');
	});
	const spanLines = spans.map(([sid, t, dt]) => `- ${sid}: ${JSON.stringify(t)} (${dt})`);
	const values: Record<string, string> = {
		data_types: typeLines.join('\n'),
		document: markedDocument,
		spans: spanLines.join('\n')
	};
	// One pass, so a document that itself contains "{{spans}}" is left as it is.
	return task.userTemplate.replace(PLACEHOLDER, (_m, key: string) => values[key]!);
}

const EXAMPLE_SPAN = /<([sg]\d+)>([\s\S]*?)<\/\1>/g;

function exampleTurns(task: Task, ex: ExamplesFile, types: ReadonlyMap<string, DataTypeInfo>): ChatMessage[] {
	const turns: ChatMessage[] = [];
	for (const example of ex.examples) {
		const found = new Map([...example.document.matchAll(EXAMPLE_SPAN)].map((m) => [m[1]!, m[2]!]));
		const spans = example.spans.map((s) => {
			if (found.get(s.id) !== s.text) throw new Error(`${task.name} example: span ${s.id} doesn't match its marker`);
			return [s.id, s.text, s.data_type] as const;
		});
		turns.push({ role: 'user', content: renderUser(task, example.document, spans, types) });
		turns.push({ role: 'assistant', content: pyJson(example.output) });
	}
	return turns;
}

/** Python's `json.dumps(obj, ensure_ascii=False)`: ", " and ": " separators. */
export function pyJson(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(pyJson).join(', ')}]`;
	if (value !== null && typeof value === 'object') {
		return `{${Object.entries(value)
			.map(([k, v]) => `${JSON.stringify(k)}: ${pyJson(v)}`)
			.join(', ')}}`;
	}
	return JSON.stringify(value);
}

/** One tier 2 call: the chat messages plus what is needed to read the answer. */
export interface Request<S extends SpanRef = SpanRef> {
	task: TaskName;
	messages: ChatMessage[];
	ids: string[];
	/** id → span in the full text. */
	spans: Map<string, S>;
}

/** The chat messages for `spans` in `text` (an excerpt starting at `offset` in the full text). */
export function buildRequest<S extends SpanRef>(
	task: Task,
	text: string,
	spans: readonly S[],
	dataTypes: ReadonlyMap<string, DataTypeInfo>,
	offset = 0,
	fewShot = true
): Request<S> {
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	const ids = sorted.map((_, i) => `${task.prefix}${i + 1}`);
	const marked = mark(text, sorted, task.prefix, offset);
	const rows = sorted.map((s, i) => [ids[i]!, text.slice(s.start - offset, s.end - offset), s.dataTypeId] as const);
	const messages: ChatMessage[] = [
		{ role: 'system', content: task.system },
		...(fewShot ? task.exampleTurns : []),
		{ role: 'user', content: renderUser(task, marked, rows, dataTypes) }
	];
	return { task: task.name, messages, ids, spans: new Map(sorted.map((s, i) => [ids[i]!, s])) };
}

export interface Excerpt<S extends SpanRef = SpanRef> {
	offset: number;
	text: string;
	spans: S[];
}

/**
 * Cut a long text into excerpts around the spans, one call each. The whole text is one excerpt
 * if it fits in `maxChars`. Otherwise each span gets `contextChars` on each side, and spans whose
 * windows overlap share an excerpt. Cut edges are left as they are.
 */
export function excerpts<S extends SpanRef>(
	text: string,
	spans: readonly S[],
	contextChars: number,
	maxChars: number
): Excerpt<S>[] {
	const sorted = [...spans].sort((a, b) => a.start - b.start);
	if (sorted.length === 0) return [];
	if (text.length <= maxChars) return [{ offset: 0, text, spans: sorted }];
	const groups: Array<[number, number, S[]]> = [];
	for (const s of sorted) {
		const a = Math.max(0, s.start - contextChars);
		const b = Math.min(text.length, s.end + contextChars);
		const last = groups.at(-1);
		if (last && a <= last[1]) {
			last[1] = Math.max(last[1], b);
			last[2].push(s);
		} else groups.push([a, b, [s]]);
	}
	return groups.map(([a, b, g]) => ({ offset: a, text: text.slice(a, b), spans: g }));
}

// --- reading answers ---

/** The model's answer isn't valid JSON for the task's schema. */
export class ResponseError extends Error {}

/** Parse the answer: plain JSON, or JSON in a ``` fence or surrounded by other text. */
export function extractJson(text: string): unknown {
	let s = text.trim();
	if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z]*\s*|\s*```$/g, '');
	try {
		return JSON.parse(s);
	} catch {
		// try the outermost braces
	}
	const a = s.indexOf('{');
	const b = s.lastIndexOf('}');
	if (a !== -1 && b > a) {
		try {
			return JSON.parse(s.slice(a, b + 1));
		} catch {
			// fall through
		}
	}
	throw new ResponseError('answer is not JSON');
}

/** The JSON Schema subset the tier 2 schemas use (as the Python `validate`). */
export function validate(obj: unknown, schema: JsonSchema, path = '$'): void {
	const t = schema.type;
	const ok =
		t === undefined ||
		(t === 'object' && obj !== null && typeof obj === 'object' && !Array.isArray(obj)) ||
		(t === 'array' && Array.isArray(obj)) ||
		(t === 'string' && typeof obj === 'string') ||
		(t === 'boolean' && typeof obj === 'boolean') ||
		(t === 'integer' && Number.isInteger(obj)) ||
		(t === 'number' && typeof obj === 'number');
	if (!ok) throw new ResponseError(`${path}: expected ${t}`);
	if (schema.enum && !schema.enum.includes(obj)) throw new ResponseError(`${path}: not in enum`);
	if (t === 'object') {
		const o = obj as Record<string, unknown>;
		const props = schema.properties ?? {};
		for (const k of schema.required ?? []) if (!(k in o)) throw new ResponseError(`${path}: missing ${k}`);
		if (schema.additionalProperties === false) {
			for (const k of Object.keys(o)) if (!(k in props)) throw new ResponseError(`${path}: unexpected ${k}`);
		}
		for (const [k, v] of Object.entries(o)) if (k in props) validate(v, props[k]!, `${path}.${k}`);
	} else if (t === 'array' && schema.items) {
		(obj as unknown[]).forEach((v, i) => validate(v, schema.items!, `${path}[${i}]`));
	} else if (t === 'string') {
		const len = [...(obj as string)].length;
		if (len < (schema.minLength ?? 0)) throw new ResponseError(`${path}: too short`);
		if (schema.maxLength !== undefined && len > schema.maxLength) throw new ResponseError(`${path}: too long`);
		if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(obj as string)) {
			throw new ResponseError(`${path}: doesn't match the pattern`);
		}
	}
}

export type AnswerEntry = Record<string, unknown> & { id: string };

/**
 * Parse and check an answer. Returns id → entry with exactly the requested ids. Throws
 * `ResponseError` when the JSON is invalid, or an id is missing, unknown or repeated.
 */
export function parseAnswer(task: Task, text: string, ids: readonly string[]): Map<string, AnswerEntry> {
	const obj = extractJson(text);
	validate(obj, task.schema);
	const out = new Map<string, AnswerEntry>();
	for (const entry of (obj as Record<string, AnswerEntry[]>)[ANSWER_ARRAY[task.name]] ?? []) {
		if (!ids.includes(entry.id)) throw new ResponseError('unknown id');
		if (out.has(entry.id)) throw new ResponseError('repeated id');
		out.set(entry.id, entry);
	}
	if (ids.some((id) => !out.has(id))) throw new ResponseError('missing ids');
	return out;
}
