/** JSON Schema copies of the contracts, for consumers outside TypeScript (e.g. `ml/` in Python). */
import * as z from 'zod';
import { AgentEvent, AgentEventBatch } from './events.ts';
import { Policy } from './policy.ts';

/** File name -> JSON Schema. Uses the *input* shape, so fields with defaults are optional. */
export function buildJsonSchemas(): Record<string, unknown> {
	const build = (schema: z.ZodType) => z.toJSONSchema(schema, { io: 'input' });
	return {
		'policy.schema.json': build(Policy),
		'agent-event.schema.json': build(AgentEvent),
		'agent-event-batch.schema.json': build(AgentEventBatch)
	};
}

export function serialize(schema: unknown): string {
	return JSON.stringify(schema, null, 2) + '\n';
}
