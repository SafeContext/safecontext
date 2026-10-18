import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildJsonSchemas, serialize } from './json-schema.ts';

describe('JSON Schema copies', () => {
	it('are up to date (run `pnpm --filter @safecontext/policy schema:export` if this fails)', () => {
		for (const [file, schema] of Object.entries(buildJsonSchemas())) {
			const committed = readFileSync(join(import.meta.dirname, '..', 'schema', file), 'utf8');
			expect(committed, file).toBe(serialize(schema));
		}
	});
});
