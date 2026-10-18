// Writes the JSON Schema copies to packages/policy/schema/. Run: pnpm --filter @safecontext/policy schema:export
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildJsonSchemas, serialize } from '../src/json-schema.ts';

const outDir = join(import.meta.dirname, '..', 'schema');
mkdirSync(outDir, { recursive: true });

for (const [file, schema] of Object.entries(buildJsonSchemas())) {
	writeFileSync(join(outDir, file), serialize(schema));
	console.log(`wrote schema/${file}`);
}
