// The live feed as server-sent events (issue #24): one `data:` message per new event of one
// organisation, each a `FeedEvent` (metadata only).
import { subscribe } from '#lib/server/event-listener.ts';
import { feedEventFromNotification } from '#lib/server/overview.ts';

/** A comment line every so often stops proxies and browsers closing an idle stream. */
const KEEPALIVE_MS = 25_000;

const HEADERS = {
	'content-type': 'text/event-stream; charset=utf-8',
	'cache-control': 'no-store',
	// Tells nginx-style proxies not to buffer the stream.
	'x-accel-buffering': 'no'
};

/**
 * Opens a stream of new events for `organizationId`. LISTEN is active before this resolves, so
 * once the browser sees the stream open, no new event is missed. Responds 503 if Postgres can't
 * be reached (the browser retries).
 */
export async function liveFeedResponse(
	organizationId: string,
	signal?: AbortSignal
): Promise<Response> {
	const encoder = new TextEncoder();
	let controller!: ReadableStreamDefaultController<Uint8Array>;
	let stop = () => {};
	let closed = false;

	const close = () => {
		if (closed) return;
		closed = true;
		stop();
		try {
			controller.close();
		} catch {
			// Already closed or cancelled.
		}
	};
	const send = (text: string) => {
		if (closed) return;
		try {
			controller.enqueue(encoder.encode(text));
		} catch {
			close();
		}
	};

	const body = new ReadableStream<Uint8Array>({
		start: (c) => {
			controller = c;
		},
		cancel: () => {
			closed = true;
			stop();
		}
	});

	let unsubscribe: () => void;
	try {
		unsubscribe = await subscribe({
			onEvent: (n) => {
				if (n.organizationId !== organizationId) return;
				const event = feedEventFromNotification(n);
				send(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
			},
			onClose: close
		});
	} catch {
		return new Response('Live feed unavailable', {
			status: 503,
			headers: { 'cache-control': 'no-store', 'retry-after': '5' }
		});
	}

	const keepalive = setInterval(() => send(': keepalive\n\n'), KEEPALIVE_MS);
	stop = () => {
		clearInterval(keepalive);
		unsubscribe();
	};
	signal?.addEventListener('abort', close, { once: true });

	// Ask the browser to retry quickly if the stream drops.
	send('retry: 2000\n\n');
	return new Response(body, { headers: HEADERS });
}
