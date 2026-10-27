/** Issue #63: the admin term lists in the policy (#8) are matched by tier 0, end to end. */
import { AGENT_API } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { createClassifier } from './classifier/classifier.ts';
import { createTier0, termListDetectors } from './classifier/tier0.ts';
import { policyWith, promptInput, testApp, toolInput, toolOutput } from './test-helpers.ts';

const { prompt, toolInput: preTool, toolOutput: postTool } = AGENT_API;

// The tier 0 that index.ts builds.
const tier0 = () => createTier0({ policyDetectors: termListDetectors });
const policy = policyWith({
	lists: [
		{ dataTypeId: 'customer-names', terms: ['Northwind', 'Fabrikam'] }, // yellow, pseudonymize
		{ dataTypeId: 'unreleased-roadmap', terms: ['Project Falcon'] } // red, block
	]
});

describe('admin term lists in tier 0', () => {
	it('catches a listed customer in a prompt, under the list’s data type', async () => {
		const { post, reports } = testApp({ policy, tiers: [tier0()] });
		// Yellow data doesn't stop a prompt yet (issue #50), but it is found and counted.
		expect((await post(prompt.path, promptInput('Draft a renewal email to Northwind'))).json).toEqual({});
		expect(reports[0]).toMatchObject({ counts: { 'customer-names': 1 }, actions: { pseudonymize: 1 } });
	});

	it('blocks a prompt with a red listed term, without echoing it', async () => {
		const { post } = testApp({ policy, tiers: [tier0()] });
		const res = await post(prompt.path, promptInput('When does project falcon launch?'));
		const out = prompt.response.parse(res.json);
		expect(out.decision).toBe('block');
		expect(out.reason).toContain('Unreleased roadmap');
		expect(out.reason?.toLowerCase()).not.toContain('falcon');
	});

	it('denies a tool call whose input has a red listed term', async () => {
		const { post } = testApp({ policy, tiers: [tier0()] });
		const res = await post(preTool.path, toolInput('Bash', { command: 'grep -r "Project Falcon" docs/' }));
		expect(preTool.response.parse(res.json).hookSpecificOutput?.permissionDecision).toBe('deny');
	});

	it('pseudonymizes listed customers in tool output, whatever their case', async () => {
		const { post } = testApp({ policy, tiers: [tier0()] });
		const stdout = 'NORTHWIND renewed; Fabrikam and northwind are both on the call.';
		const res = await post(postTool.path, toolOutput('Bash', { stdout, stderr: '' }));
		expect(postTool.response.parse(res.json).hookSpecificOutput?.updatedToolOutput).toEqual({
			stdout: 'customer_name_1 renewed; customer_name_2 and customer_name_1 are both on the call.',
			stderr: ''
		});
	});

	it('does nothing when the policy has no lists', async () => {
		const { post } = testApp({ policy: policyWith(), tiers: [tier0()] });
		const res = await post(postTool.path, toolOutput('Bash', { stdout: 'Northwind', stderr: '' }));
		expect(res.json).toEqual({});
	});
});

// SPEC.md §4: tier 0 < 10 ms. Through the whole classifier, with 10k admin terms, on 5 KB of text.
describe('latency with 10k admin terms', () => {
	const RUNS = 50;
	const terms = Array.from({ length: 10_000 }, (_, i) => `Customer${i.toString(36)} Holdings`);
	const big = policyWith({ lists: [{ dataTypeId: 'customer-names', terms }] });
	const unit = `Call with ${terms[4_242]} about the invoice; jane@example.com cc'd. Build passed in 3m.\n`;
	const text = unit.repeat(Math.ceil(5_120 / unit.length)).slice(0, 5_120);

	it('stays well under 10 ms at p95', async () => {
		const classifier = createClassifier({ tiers: [tier0()], budgetMs: 1_000 });
		const first = await classifier.classify([text], big); // builds the matcher once per policy
		expect(first.ok && first.spans[0]!.some((s) => s.dataTypeId === 'customer-names')).toBe(true);

		const times: number[] = [];
		for (let i = 0; i < RUNS; i++) {
			const result = await classifier.classify([text], big);
			if (result.ok) times.push(result.ms);
		}
		times.sort((a, b) => a - b);
		const p95 = times[Math.ceil(RUNS * 0.95) - 1]!;
		console.info(`tier 0, 10k terms, 5 KB: p50 ${times[RUNS / 2]!.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms`);
		expect(times).toHaveLength(RUNS);
		expect(p95).toBeLessThan(10);
	});
});
