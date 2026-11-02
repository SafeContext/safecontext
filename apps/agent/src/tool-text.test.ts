import { describe, expect, it } from 'vitest';
import { loadFixtures, shapeOf } from './test-helpers.ts';
import { mapToolOutputText, toolInputTexts, toolOutputTexts } from './tool-text.ts';

describe.each(loadFixtures())('%s fixture', (_name, fx) => {
	const response = fx.postToolUseInput.tool_response;

	it('finds the text fields', () => {
		expect(toolOutputTexts(fx.tool, response).length).toBeGreaterThan(0);
	});

	it('replaces text without changing the shape or the input', () => {
		const before = JSON.stringify(response);
		const mapped = mapToolOutputText(fx.tool, response, (_t, i) => `#${i}`);
		expect(shapeOf(mapped)).toEqual(shapeOf(response));
		expect(JSON.stringify(response)).toBe(before);
		const texts = toolOutputTexts(fx.tool, mapped);
		expect(texts).toEqual(texts.map((_t, i) => `#${i}`));
	});
});

describe('per-tool fields', () => {
	const fx = Object.fromEntries(loadFixtures());

	it('Read: only file.content (not the path)', () => {
		const r = fx.read!.postToolUseInput.tool_response as { file: { content: string } };
		expect(toolOutputTexts('Read', r)).toEqual([r.file.content]);
	});

	it('Bash: stdout and stderr', () => {
		expect(toolOutputTexts('Bash', { stdout: 'o', stderr: 'e', interrupted: false })).toEqual(['o', 'e']);
	});

	it('Grep: content and file names', () => {
		expect(toolOutputTexts('Grep', { mode: 'files_with_matches', filenames: ['a', 'b'], numFiles: 2 })).toEqual([
			'a',
			'b'
		]);
	});

	it('WebSearch: summary strings, titles and urls, not the query', () => {
		const r = { query: 'q', results: [{ tool_use_id: 'x', content: [{ title: 't', url: 'u' }] }, 's'], searchCount: 1 };
		expect(toolOutputTexts('WebSearch', r)).toEqual(['t', 'u', 's']);
	});

	it('MCP: text blocks only, and plain strings', () => {
		const r = [
			{ type: 'text', text: 'a' },
			{ type: 'image', data: 'b64', mimeType: 'image/png' }
		];
		expect(toolOutputTexts('mcp__x__y', r)).toEqual(['a']);
		expect(toolOutputTexts('mcp__x__y', 'plain')).toEqual(['plain']);
	});

	describe('Agent (subagent report)', () => {
		// Shape from https://code.claude.com/docs/en/hooks (Agent tool) and the e2e run (issue #41).
		const report = {
			status: 'completed',
			agentId: 'a4d2c8f1e0b3a297',
			content: [
				{ type: 'text', text: 'first' },
				{ type: 'image', source: { data: 'b64' } },
				{ type: 'text', text: 'second' }
			],
			resolvedModel: 'claude-haiku-4-5',
			totalTokens: 10,
			totalDurationMs: 5,
			totalToolUseCount: 1,
			usage: { input_tokens: 8, output_tokens: 2 }
		};

		it('only the text blocks', () => {
			expect(toolOutputTexts('Agent', report)).toEqual(['first', 'second']);
		});

		it('keeps status and the other fields when every text is replaced', () => {
			const mapped = mapToolOutputText('Agent', report, () => 'notice');
			expect(mapped).toEqual({
				...report,
				content: [
					{ type: 'text', text: 'notice' },
					{ type: 'image', source: { data: 'b64' } },
					{ type: 'text', text: 'notice' }
				]
			});
		});

		it('a background launch (no content) falls back to every string', () => {
			const launched = { status: 'async_launched', agentId: 'a1', description: 'd', prompt: 'p', outputFile: '/o' };
			expect(toolOutputTexts('Agent', launched)).toEqual(['async_launched', 'a1', 'd', 'p', '/o']);
		});
	});

	it('falls back to every string when a known tool has an unexpected shape', () => {
		expect(toolOutputTexts('Read', { type: 'image', file: { base64: 'abc', type: 'image/png' } })).toEqual([
			'image',
			'abc',
			'image/png'
		]);
	});

	it('tool input: every string at any depth', () => {
		expect(toolInputTexts({ url: 'u', prompt: 'p', opts: { n: 1, tags: ['x'] } })).toEqual(['u', 'p', 'x']);
	});
});
