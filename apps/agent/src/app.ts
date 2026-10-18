import { AGENT_API, type HealthResponse } from '@safecontext/policy';
import { Hono } from 'hono';

// Local Safe Context agent. Claude Code hooks call this over localhost.
// See SPEC.md ("Agent API") for the endpoints to implement.
export const app = new Hono();

// Policy loading lands in issue #9.
app.get(AGENT_API.health.path, (c) => c.json({ ok: true, policyVersion: 0 } satisfies HealthResponse));
