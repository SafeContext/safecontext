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
