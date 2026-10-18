import { serve } from '@hono/node-server';
import { AGENT_DEFAULT_PORT, AGENT_HOST } from '@safecontext/policy';
import { app } from './app.ts';

const port = Number(process.env.SC_AGENT_PORT ?? AGENT_DEFAULT_PORT);

serve({ fetch: app.fetch, hostname: AGENT_HOST, port }, (info) => {
	console.log(`safecontext agent listening on http://${AGENT_HOST}:${info.port}`);
});
