import { AGENT_API } from '@safecontext/policy';
import { describe, expect, it } from 'vitest';
import { app } from './app.ts';

describe('GET /health', () => {
	it('returns a valid HealthResponse', async () => {
		const res = await app.request(AGENT_API.health.path);
		expect(res.status).toBe(200);
		expect(AGENT_API.health.response.safeParse(await res.json()).success).toBe(true);
	});
});
