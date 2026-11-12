/** Synthetic hook flow with actual local files; does not launch Claude or any model. */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENT_API } from '@safecontext/policy';
import { afterAll, describe, expect, it } from 'vitest';
import { messages } from './messages.ts';
import { shapeOf, termTier, testApp, toolInput, toolOutput } from './test-helpers.ts';

const fixture = realpathSync(mkdtempSync(join(tmpdir(), 'Safe Context hooks Jos\u00e9 ')));
const project = join(fixture, 'project');
const outside = join(fixture, 'outside');
mkdirSync(project);
mkdirSync(join(project, 'deals'));
mkdirSync(outside);
symlinkSync(outside, join(project, 'outside-link'), process.platform === 'win32' ? 'junction' : 'dir');
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

const value = 'Northwind';
const placeholder = '\u27eacustomer_name_1\u27eb';
const before = (tool: string, input: Record<string, unknown>) => ({ ...toolInput(tool, input), cwd: project });
const after = (tool: string, response: unknown) => ({ ...toolOutput(tool, response), cwd: project });

async function learnedApp() {
	const app = testApp({ tiers: [termTier({ [value]: 'customer-names' })] });
	await app.post(
		AGENT_API.toolOutput.path,
		after('Read', {
			type: 'text',
			file: { filePath: join(project, 'crm.md'), content: `CRM: ${value}`, numLines: 1, startLine: 1, totalLines: 1 }
		})
	);
	return app;
}

describe('file restoration and return-path privacy in a real project', () => {
	it('writes a restored value locally and hides the echoed content and filename again', async () => {
		const { post, logger, reports } = await learnedApp();
		const path = join('deals', `${placeholder} Jos\u00e9.md`);
		const checked = await post(
			AGENT_API.toolInput.path,
			before('Write', { file_path: path, content: `Call ${placeholder}` })
		);
		const output = AGENT_API.toolInput.response.parse(checked.json).hookSpecificOutput;
		expect(output?.permissionDecision).toBeUndefined();
		expect(output?.updatedInput).toEqual({ file_path: path.replace(placeholder, value), content: `Call ${value}` });
		const written = join(project, 'deals', `${value} Jos\u00e9.md`);
		// Simulate only the exact local Write that was asserted above, inside the owned fixture.
		writeFileSync(written, output!.updatedInput!.content as string);
		const response = { type: 'create', filePath: written, content: readFileSync(written, 'utf8') };
		const returned = await post(AGENT_API.toolOutput.path, after('Write', response));
		const cleaned = AGENT_API.toolOutput.response.parse(returned.json).hookSpecificOutput?.updatedToolOutput;
		expect(shapeOf(cleaned)).toEqual(shapeOf(response));
		expect(JSON.stringify(cleaned)).not.toContain(value);
		expect(JSON.stringify(cleaned)).toContain(placeholder);
		expect(JSON.stringify(logger.records)).not.toContain(value);
		expect(JSON.stringify(reports)).not.toContain(value);
		expect(JSON.stringify([...logger.records, ...reports])).not.toContain(project);
	});

	it('denies a restored write through an outside link without returning updated input', async () => {
		const { post } = await learnedApp();
		const result = await post(
			AGENT_API.toolInput.path,
			before('Write', {
				file_path: join('outside-link', 'note.md'),
				content: placeholder
			})
		);
		const output = AGENT_API.toolInput.response.parse(result.json).hookSpecificOutput;
		expect(output?.permissionDecision).toBe('deny');
		expect(output?.updatedInput).toBeUndefined();
		expect(JSON.stringify(result.json)).not.toContain(value);
	});

	it('denies an unknown placeholder after an agent restart', async () => {
		const { post } = testApp();
		const result = await post(AGENT_API.toolInput.path, before('Read', { file_path: `${placeholder}.md` }));
		expect(AGENT_API.toolInput.response.parse(result.json).hookSpecificOutput).toEqual({
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason: messages.restoreUnknown(['customer_name_1'])
		});
	});

	it('leaves PowerShell placeholders untouched and checks all returned strings as an unknown tool', async () => {
		const { post, logger, reports } = await learnedApp();
		expect(
			(await post(AGENT_API.toolInput.path, before('PowerShell', { command: `Write-Output ${placeholder}` }))).json
		).toEqual({});
		// Deliberately synthetic: no claim this is an observed Windows Claude tool-response shape.
		const synthetic = { stdout: value, stderr: `Warning: ${value}`, nested: { extra: value }, exitCode: 0 };
		const result = await post(AGENT_API.toolOutput.path, after('PowerShell', synthetic));
		const cleaned = AGENT_API.toolOutput.response.parse(result.json).hookSpecificOutput?.updatedToolOutput;
		expect(shapeOf(cleaned)).toEqual(shapeOf(synthetic));
		expect(JSON.stringify(cleaned)).not.toContain(value);
		expect(JSON.stringify([...logger.records, ...reports])).not.toContain(value);
	});

	it.skipIf(process.platform !== 'win32')(
		'denies an unsupported namespace with valid hook JSON and no echoed value',
		async () => {
			const { post } = await learnedApp();
			const result = await post(
				AGENT_API.toolInput.path,
				before('Edit', {
					file_path: '\\\\synthetic-invalid-host\\share\\note.md',
					old_string: placeholder,
					new_string: 'new'
				})
			);
			expect(AGENT_API.toolInput.response.parse(result.json).hookSpecificOutput).toEqual({
				hookEventName: 'PreToolUse',
				permissionDecision: 'deny',
				permissionDecisionReason: messages.restoreUnsupportedPath()
			});
			expect(JSON.stringify(result.json)).not.toContain(value);
		}
	);
});
