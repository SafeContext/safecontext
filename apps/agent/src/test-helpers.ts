/** Shared test setup. Not imported by the agent itself. */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPolicy, type Policy, type PolicyInput, Policy as PolicySchema } from '@safecontext/policy';
import { createApp } from './app.ts';
import { createClassifier } from './classifier/classifier.ts';
import { createTier0 } from './classifier/tier0.ts';
import type { ClassifierTier } from './classifier/types.ts';
import type { CheckReport } from './events.ts';
import { memoryLogger } from './log.ts';
import { staticPolicySource } from './policy-source.ts';

/** A fake GitHub token, built at run time so no real-looking key sits in the source. */
export const SECRET = 'ghp_' + 'aB3dE5gH7jK9mN1pQ2rS4tU6vW8xY0zC'.repeat(2).slice(0, 36);
/** A made-up string that must never show up in logs or events. */
export const CANARY = 'MH-CANARY-NEVER-LOG-7731';

export function policyWith(overrides: Partial<PolicyInput> = {}): Policy {
	const base = defaultPolicy(new Date('2026-01-01T00:00:00Z'));
	return PolicySchema.parse({ ...base, ...overrides });
}

export interface TestAppOptions {
	policy?: Policy;
	tiers?: ClassifierTier[];
	budgetMs?: number;
}

export function testApp({ policy = policyWith(), tiers = [createTier0()], budgetMs = 1_000 }: TestAppOptions = {}) {
	const logger = memoryLogger();
	const reports: CheckReport[] = [];
	const app = createApp({
		policy: staticPolicySource(policy),
		classifier: createClassifier({ tiers, budgetMs }),
		logger,
		events: { record: (r) => reports.push(r) }
	});
	const post = async (path: string, body: unknown) => {
		const res = await app.request(path, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: typeof body === 'string' ? body : JSON.stringify(body)
		});
		return { status: res.status, json: (await res.json()) as Record<string, unknown> };
	};
	return { app, logger, reports, post };
}

export interface HookFixture {
	tool: string;
	preToolUseInput: Record<string, unknown> & { tool_input: Record<string, unknown> };
	postToolUseInput: Record<string, unknown> & { tool_name: string; tool_response: unknown };
}

/** Real (scrubbed) Claude Code payloads from issue #3. */
export function loadFixtures(): Array<[string, HookFixture]> {
	const dir = join(import.meta.dirname, '../../../packages/policy/fixtures/hooks');
	return readdirSync(dir)
		.filter((f) => f.endsWith('.json'))
		.sort()
		.map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(dir, f), 'utf8')) as HookFixture]);
}

export const promptInput = (prompt: string) => ({
	session_id: 'SESSION_ID',
	cwd: '/work/project',
	hook_event_name: 'UserPromptSubmit',
	prompt
});

export const toolInput = (tool_name: string, tool_input: Record<string, unknown>) => ({
	session_id: 'SESSION_ID',
	cwd: '/work/project',
	hook_event_name: 'PreToolUse',
	tool_name,
	tool_input,
	tool_use_id: 'toolu_1'
});

export const toolOutput = (tool_name: string, tool_response: unknown) => ({
	...toolInput(tool_name, {}),
	hook_event_name: 'PostToolUse',
	tool_response
});

/** Same structure (keys, array-ness, value types), ignoring the values. */
export function shapeOf(v: unknown): unknown {
	if (Array.isArray(v)) return v.map(shapeOf);
	if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shapeOf(x)]));
	return typeof v;
}

/** A tier that flags every occurrence of each term as the given data type (like an admin term list). */
export function termTier(terms: Record<string, string>, id = 'terms'): ClassifierTier {
	return {
		id,
		tier: 0,
		detect: (texts) =>
			texts.map((text) =>
				Object.entries(terms).flatMap(([term, dataTypeId]) => {
					const spans = [];
					for (let i = text.indexOf(term); i !== -1; i = text.indexOf(term, i + term.length)) {
						spans.push({ start: i, end: i + term.length, dataTypeId, source: 'list' as const, confidence: 1 });
					}
					return spans;
				})
			)
	};
}

/** A tier that answers after `ms`, or throws. */
export function fakeTier(opts: {
	id?: string;
	ms?: number;
	throws?: boolean;
	spans?: ClassifierTier['detect'];
}): ClassifierTier {
	return {
		id: opts.id ?? 'fake',
		tier: 1,
		async detect(texts, ctx) {
			if (opts.ms) await new Promise((r) => setTimeout(r, opts.ms));
			if (opts.throws) throw new Error('boom');
			return opts.spans ? opts.spans(texts, ctx) : texts.map(() => []);
		}
	};
}
