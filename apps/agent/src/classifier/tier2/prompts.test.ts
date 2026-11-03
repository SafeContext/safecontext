import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	DEFAULT_TIER2_BASE_URL,
	DEFAULT_TIER2_PROMPTS_DIR,
	PINNED_TIER2_DIGEST,
	PINNED_TIER2_MODEL
} from '../../config.ts';
import {
	buildRequest,
	excerpts,
	loadPrompts,
	mark,
	parseAnswer,
	ResponseError,
	TASKS,
	type DataTypeInfo,
	type SpanRef,
	type TaskName
} from './prompts.ts';

const prompts = loadPrompts(DEFAULT_TIER2_PROMPTS_DIR);

interface Fixture {
	data_types: Record<string, { name: string; description: string }>;
	cases: Array<{
		task: TaskName;
		text: string;
		spans: Array<{ start: number; end: number; data_type: string }>;
		requests: Array<{ ids: string[]; messages: unknown[] }>;
	}>;
}

describe('prompt rendering matches the Python reference (scripts/tier2-render-fixture.py)', () => {
	const fixture = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures/render.json'), 'utf8')) as Fixture;
	const types = new Map<string, DataTypeInfo>(Object.entries(fixture.data_types).map(([id, t]) => [id, { id, ...t }]));

	it.each(fixture.cases.map((c, i) => [i, c] as const))('case %i', (_i, c) => {
		const spans: SpanRef[] = c.spans.map((s) => ({ start: s.start, end: s.end, dataTypeId: s.data_type }));
		const { context_chars, max_chars } = prompts.manifest.excerpts;
		const got = excerpts(c.text, spans, context_chars, max_chars).map((ex) => {
			const req = buildRequest(prompts.tasks[c.task], ex.text, ex.spans, types, ex.offset);
			return { ids: req.ids, messages: req.messages };
		});
		expect(got).toEqual(c.requests);
	});
});

describe('prompt files', () => {
	it.each(TASKS)('%s: loads, and each example answer passes the answer checks', (name) => {
		const task = prompts.tasks[name];
		expect(task.system.length).toBeGreaterThan(0);
		expect(task.userTemplate).toContain('{{document}}');
		expect(task.exampleTurns.length % 2).toBe(0);
		for (let i = 0; i < task.exampleTurns.length; i += 2) {
			const user = task.exampleTurns[i]!.content;
			const ids = [...user.matchAll(/^- ([sg]\d+): /gm)].map((m) => m[1]!);
			expect(parseAnswer(task, task.exampleTurns[i + 1]!.content, ids).size).toBe(ids.length);
		}
	});

	it('has what the agent needs in tier2.json', () => {
		const m = prompts.manifest;
		expect(m.timeouts.per_call_ms).toBeLessThan(8000);
		expect(m.timeouts.min_budget_ms).toBeGreaterThan(0);
		expect(m.tasks.context.labels).toEqual(['unreleased-roadmap', 'revenue-figures', 'internal-metrics', 'deal-sizes']);
	});

	it('pins the same model and digest as ml/models.lock.json', () => {
		const lock = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../../ml/models.lock.json'), 'utf8')) as {
			external: Array<{ name: string; model: string; digest: string; settings: { base_url: string } }>;
		};
		const entry = lock.external.find((e) => e.name === 'tier2-llm')!;
		expect([entry.model, entry.digest, entry.settings.base_url]).toEqual([
			PINNED_TIER2_MODEL,
			PINNED_TIER2_DIGEST,
			DEFAULT_TIER2_BASE_URL
		]);
	});
});

describe('rendering', () => {
	const task = prompts.tasks.context;
	const types = new Map<string, DataTypeInfo>();

	it('fills placeholders in one pass', () => {
		const text = 'Notes: {{spans}} and {{data_types}} stay literal. Heron ships.';
		const a = text.indexOf('Heron');
		const user = buildRequest(
			task,
			text,
			[{ start: a, end: a + 5, dataTypeId: 'unreleased-roadmap' }],
			types,
			0,
			false
		).messages.at(-1)!.content;
		expect(user).toContain('Notes: {{spans}} and {{data_types}} stay literal. <s1>Heron</s1> ships.');
		expect(user.split('- s1: "Heron" (unreleased-roadmap)').length).toBe(2);
	});

	it('rejects overlapping spans', () => {
		expect(() =>
			mark(
				'abcdef',
				[
					{ start: 0, end: 3, dataTypeId: 'x' },
					{ start: 2, end: 4, dataTypeId: 'x' }
				],
				's'
			)
		).toThrow();
	});

	it('cuts long texts into excerpts around the spans', () => {
		const text = 'a'.repeat(100) + 'SECRET' + 'b'.repeat(1000) + 'OTHER' + 'c'.repeat(100);
		const s1 = { start: 100, end: 106, dataTypeId: 'x' };
		const s2 = { start: 1106, end: 1111, dataTypeId: 'x' };
		expect(excerpts(text, [s1, s2], 50, 5000)).toEqual([{ offset: 0, text, spans: [s1, s2] }]);
		const ex = excerpts(text, [s2, s1], 50, 500);
		expect(ex.map((e) => e.spans)).toEqual([[s1], [s2]]);
		for (const e of ex) {
			for (const s of e.spans)
				expect(e.text.slice(s.start - e.offset, s.end - e.offset)).toBe(text.slice(s.start, s.end));
		}
		expect(excerpts(text, [s1, s2], 600, 500)).toHaveLength(1);
	});
});

describe('parseAnswer', () => {
	const task = prompts.tasks.context;

	it.each([
		'{"spans": [{"id": "s1", "reason": "x", "sensitive": true}]}',
		'```json\n{"spans": [{"id": "s1", "reason": "x", "sensitive": true}]}\n```',
		'Here you go: {"spans": [{"id": "s1", "reason": "x", "sensitive": true}]} done'
	])('accepts JSON with noise: %s', (answer) => {
		expect(parseAnswer(task, answer, ['s1']).get('s1')!.sensitive).toBe(true);
	});

	it.each([
		'not json',
		'{"spans": [{"id": "s1", "reason": "x"}]}',
		'{"spans": [{"id": "s1", "reason": "x", "sensitive": "yes"}]}',
		'{"spans": [{"id": "s2", "reason": "x", "sensitive": true}]}',
		'{"spans": []}',
		'{"spans": [{"id": "s1", "reason": "x", "sensitive": true}, {"id": "s1", "reason": "x", "sensitive": true}]}',
		'{"spans": [{"id": "s1", "reason": "x", "sensitive": true, "extra": 1}]}'
	])('rejects a bad answer: %s', (answer) => {
		expect(() => parseAnswer(task, answer, ['s1'])).toThrow(ResponseError);
	});

	it('enforces the generalize length limit', () => {
		const long = JSON.stringify({ rewrites: [{ id: 'g1', text: 'x'.repeat(61) }] });
		expect(() => parseAnswer(prompts.tasks.generalize, long, ['g1'])).toThrow(ResponseError);
	});
});
