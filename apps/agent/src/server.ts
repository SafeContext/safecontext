import { serve } from '@hono/node-server';
import { AGENT_HOST } from '@safecontext/policy';
import type { Hono } from 'hono';
import type { AddressInfo } from 'node:net';

export interface RunningServer {
	/** The bound port (useful when started with port 0). */
	port: number;
	close(): Promise<void>;
}

/** Serve `app` on loopback only (SPEC.md §3). Port 0 picks a free port, for tests. */
export function startServer(app: Hono, port: number): Promise<RunningServer> {
	return new Promise((resolve, reject) => {
		const server = serve({ fetch: app.fetch, hostname: AGENT_HOST, port }, (info: AddressInfo) => {
			resolve({
				port: info.port,
				close: () =>
					new Promise<void>((done, fail) => {
						server.close((err) => (err ? fail(err) : done()));
						if ('closeAllConnections' in server) server.closeAllConnections();
					})
			});
		});
		server.once('error', reject);
	});
}
