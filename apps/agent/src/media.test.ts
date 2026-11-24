/** Images and PDFs Claude reads (#40): their text is checked before the Read runs. */
import { AGENT_API } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { createTier0 } from './classifier/tier0.ts';
import { mediaKind, type Extractor } from './extract.ts';
import { messages } from './messages.ts';
import { policyWith, termTier, testApp, toolInput } from './test-helpers.ts';

const { toolInput: preTool } = AGENT_API;
const key = `AKIA${'IOSFODNN7EXAMPLE'}`;

/** A fake extractor that returns `text` for any file, and records the paths it was asked for. */
function fakeExtractor(text: string | Error) {
	const paths: string[] = [];
	const extractor: Extractor = {
		extract: async (path) => {
			paths.push(path);
			if (text instanceof Error) throw text;
			return text;
		}
	};
	return { extractor, paths };
}

const read = (file_path: string) => toolInput('Read', { file_path });
const decisionOf = (json: Record<string, unknown>) => preTool.response.parse(json).hookSpecificOutput;

describe('images and PDFs (#40)', () => {
	it('stops a Read of a screenshot that holds a key, naming only the data type', async () => {
		const { extractor, paths } = fakeExtractor(`Staging deploy key:\n${key}`);
		const { post, reports } = testApp({ extractor });
		const out = decisionOf((await post(preTool.path, read('shots/deploy.png'))).json);
		expect(out?.permissionDecision).toBe('deny');
		expect(out?.permissionDecisionReason).toContain('this image');
		expect(out?.permissionDecisionReason).toContain('API keys & secrets');
		expect(out?.permissionDecisionReason).not.toContain(key);
		expect(paths).toEqual(['/work/project/shots/deploy.png']);
		expect(reports.at(-1)).toMatchObject({ blocked: true });
	});

	it('stops a PDF with "make it vague" data too: it can\'t be shown with parts hidden', async () => {
		const { extractor } = fakeExtractor('Renewal notes for Northwind');
		const { post } = testApp({ extractor, tiers: [createTier0(), termTier({ Northwind: 'customer-names' })] });
		const out = decisionOf((await post(preTool.path, read('/docs/notes.PDF'))).json);
		expect(out?.permissionDecision).toBe('deny');
		expect(out?.permissionDecisionReason).toBe(
			messages.mediaBlocked('PDF', [
				{ dataTypeId: 'customer-names', name: 'Customer names', tier: 'yellow', action: 'pseudonymize', count: 1 }
			])
		);
	});

	it('lets a clean image through', async () => {
		const { extractor } = fakeExtractor('A diagram of the checkout flow');
		const { post } = testApp({ extractor });
		expect((await post(preTool.path, read('diagram.png'))).json).toEqual({});
	});

	it("follows the fail mode when the text can't be pulled out", async () => {
		const { extractor } = fakeExtractor(new Error('boom'));
		const blocked = decisionOf((await testApp({ extractor }).post(preTool.path, read('a.jpg'))).json);
		expect(blocked).toMatchObject({
			permissionDecision: 'deny',
			permissionDecisionReason: messages.mediaUnchecked('image')
		});
		const allow = testApp({ extractor, policy: policyWith({ failMode: 'allow' }) });
		expect((await allow.post(preTool.path, read('a.jpg'))).json).toEqual({});
	});

	it('fails closed without the extraction helper', async () => {
		const out = decisionOf((await testApp().post(preTool.path, read('a.webp'))).json);
		expect(out?.permissionDecision).toBe('deny');
	});

	it('leaves other files and tools to the normal checks', async () => {
		const { extractor, paths } = fakeExtractor(key);
		const { post } = testApp({ extractor });
		expect((await post(preTool.path, read('notes.md'))).json).toEqual({});
		expect((await post(preTool.path, toolInput('Bash', { command: 'open a.png' }))).json).toEqual({});
		expect(paths).toEqual([]);
	});

	it('knows which files Read shows Claude as an image or a PDF', () => {
		expect(mediaKind('/a/b.PNG')).toBe('image');
		expect(mediaKind('scan.heic')).toBe('image');
		expect(mediaKind('report.pdf')).toBe('PDF');
		expect(mediaKind('notes.md')).toBeUndefined();
		expect(mediaKind('Makefile')).toBeUndefined();
	});
});
