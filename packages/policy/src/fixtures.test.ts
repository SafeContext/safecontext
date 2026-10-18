import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PostToolUseInput, PostToolUseOutput, PreToolUseInput } from './hooks.ts';

// Real (scrubbed) hook payloads captured from Claude Code. See docs/hook-shapes.md.
const dir = join(import.meta.dirname, '../fixtures/hooks');
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('hook fixtures', () => {
	it('cover the six tools from issue #3', () => {
		expect(files.sort()).toEqual([
			'bash.json',
			'grep.json',
			'mcp.json',
			'read.json',
			'webfetch.json',
			'websearch.json'
		]);
	});

	for (const file of files) {
		it(`${file} parses with the hooks.ts schemas`, () => {
			const fx = JSON.parse(readFileSync(join(dir, file), 'utf8'));
			expect(PreToolUseInput.parse(fx.preToolUseInput).tool_name).toBe(fx.tool);
			const post = PostToolUseInput.parse(fx.postToolUseInput);
			expect(post.tool_name).toBe(fx.tool);
			expect(post.tool_response).toBeDefined();
			PostToolUseOutput.parse(fx.postToolUseOutputThatWasApplied);
		});

		it(`${file} keeps the replacement the same shape as the original response`, () => {
			const fx = JSON.parse(readFileSync(join(dir, file), 'utf8'));
			const shape = (v: unknown): unknown =>
				Array.isArray(v)
					? ['array', v.length > 0 ? shape(v[0]) : null]
					: v && typeof v === 'object'
						? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shape(x)]))
						: typeof v;
			const original = fx.postToolUseInput.tool_response;
			const replaced = fx.postToolUseOutputThatWasApplied.hookSpecificOutput.updatedToolOutput;
			expect(shape(replaced)).toEqual(shape(original));
		});
	}
});
