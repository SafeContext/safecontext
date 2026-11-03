/** A fake OpenAI-compatible model server on an ephemeral port, for tier 2 tests. Not used by the agent. */
import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeRequest {
	method: string;
	path: string;
	headers: IncomingHttpHeaders;
	body: Record<string, unknown> | undefined;
}

export interface FakeReply {
	status?: number;
	/** A string is sent as is; anything else as JSON. */
	body?: unknown;
	delayMs?: number;
}

export type ChatAnswer = (req: FakeRequest) => FakeReply | string | Promise<FakeReply | string>;

/** A chat completion carrying `content`. */
export const completion = (content: string, finishReason = 'stop') => ({
	choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }]
});

/** The last user message of a chat request (the one with the real document). */
export const lastUser = (req: FakeRequest) => {
	const messages = (req.body?.messages ?? []) as Array<{ role: string; content: string }>;
	return messages.filter((m) => m.role === 'user').at(-1)?.content ?? '';
};

/** The span ids asked about in the last user message ("s1", "g2", ...). */
export const askedIds = (req: FakeRequest) => [...lastUser(req).matchAll(/^- ([sg]\d+): /gm)].map((m) => m[1]!);

export async function startFakeModelServer(
	chat: ChatAnswer,
	tags: unknown = {
		models: [
			{ name: 'gemma4:e4b-it-q4_K_M', digest: 'dc35e8d9c6061baa6f0fa870975ab6932e2542b579b13ea0f199fa4bb7300c9c' }
		]
	}
) {
	const requests: FakeRequest[] = [];
	const server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
		req.on('end', () => {
			void (async () => {
				let body: Record<string, unknown> | undefined;
				try {
					body = raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
				} catch {
					body = undefined;
				}
				const fr: FakeRequest = { method: req.method ?? '', path: req.url ?? '', headers: req.headers, body };
				requests.push(fr);
				let reply: FakeReply;
				if (fr.path === '/api/tags') reply = tags === null ? { status: 404, body: 'not found' } : { body: tags };
				else if (fr.path === '/v1/chat/completions') {
					const a = await chat(fr);
					reply = typeof a === 'string' ? { body: completion(a) } : a;
				} else reply = { status: 404, body: 'not found' };
				if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
				if (res.destroyed) return;
				const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body ?? {});
				res.writeHead(reply.status ?? 200, { 'content-type': 'application/json' });
				res.end(text);
			})();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const { port } = server.address() as AddressInfo;
	return {
		baseUrl: `http://127.0.0.1:${port}/v1`,
		requests,
		chats: () => requests.filter((r) => r.path === '/v1/chat/completions'),
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			})
	};
}
