import { serve } from '@hono/node-server';
import { Hono } from 'hono';

// Local Safe Context agent. Claude Code hooks call this over localhost.
// See SPEC.md ("Agent API") for the endpoints to implement.
const app = new Hono();

app.get('/health', (c) => c.json({ ok: true }));

const port = Number(process.env.SC_AGENT_PORT ?? 4747);

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => {
	console.log(`safecontext agent listening on http://127.0.0.1:${info.port}`);
});
