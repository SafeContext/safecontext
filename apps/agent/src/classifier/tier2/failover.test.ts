/** The company's model server first, this Mac's model when it can't be used (#75). */
import { describe, expect, it } from 'vitest';
import { memoryLogger } from '../../log.ts';
import { Tier2CallError, type ChatOptions, type Tier2Client, type Tier2Reason } from './client.ts';
import { failoverClient } from './failover.ts';

function fakeClient(name: string, behave: () => string | Tier2Reason) {
	const calls: ChatOptions[] = [];
	const client: Tier2Client = {
		baseUrl: `https://${name}`,
		model: name,
		listModels: async () => [],
		async chat(options) {
			calls.push(options);
			const r = behave();
			if (r.startsWith('answer')) return r;
			throw new Tier2CallError(r as Tier2Reason);
		}
	};
	return { client, calls };
}

const options = (over: Partial<ChatOptions> = {}): ChatOptions => ({
	messages: [],
	schema: {},
	maxTokens: 10,
	timeoutMs: 6_000,
	...over
});

function setup(serverSays: () => string | Tier2Reason, localSays: () => string | Tier2Reason = () => 'answer-local') {
	let t = 0;
	const server = fakeClient('server', serverSays);
	const local = fakeClient('local', localSays);
	const logger = memoryLogger();
	const client = failoverClient({ server: server.client, local: local.client, logger, now: () => t });
	return { client, server, local, logger, advance: (ms: number) => (t += ms) };
}

describe('failoverClient', () => {
	it('uses the server while it answers', async () => {
		const { client, local } = setup(() => 'answer-server');
		expect(await client.chat(options())).toBe('answer-server');
		expect(local.calls).toHaveLength(0);
	});

	it.each(['unreachable', 'timeout', 'http_error'] as const)(
		'answers from this Mac when the server fails with %s, then skips the server for a while',
		async (reason) => {
			let serverUp = false;
			const { client, server, local, logger, advance } = setup(() => (serverUp ? 'answer-server' : reason));
			expect(await client.chat(options())).toBe('answer-local');
			expect(await client.chat(options())).toBe('answer-local');
			expect(server.calls).toHaveLength(1); // the second call went straight to this Mac
			advance(30_000);
			serverUp = true;
			expect(await client.chat(options())).toBe('answer-server');
			expect(logger.records.map((r) => [r.msg, r.reason])).toEqual([
				['tier2_failover', reason],
				['tier2_server_back', undefined]
			]);
			expect(local.calls).toHaveLength(2);
		}
	);

	it('gives this Mac only the time left in the call, and none when too little is left', async () => {
		let t = 0;
		const server = fakeClient('server', () => {
			t += 4_000; // the server took 4 s to fail
			return 'timeout';
		});
		const local = fakeClient('local', () => 'answer-local');
		const client = failoverClient({ server: server.client, local: local.client, now: () => t });
		expect(await client.chat(options())).toBe('answer-local');
		expect(local.calls[0]!.timeoutMs).toBe(2_000);

		t += 30_000;
		await expect(client.chat(options({ timeoutMs: 5_000 }))).rejects.toMatchObject({ reason: 'timeout' });
		expect(local.calls).toHaveLength(1);
	});

	it('keeps time for this Mac when it tries a server that was down (PR #136 review)', async () => {
		let t = 0;
		const server = fakeClient('server', () => 'timeout');
		const local = fakeClient('local', () => 'answer-local');
		const client = failoverClient({ server: server.client, local: local.client, now: () => t });
		await client.chat(options());
		t += 30_000;
		server.client.chat = async (o) => {
			server.calls.push(o);
			t += o.timeoutMs; // still hanging: uses all it was given
			throw new Tier2CallError('timeout');
		};
		expect(await client.chat(options())).toBe('answer-local');
		expect(server.calls.at(-1)!.timeoutMs).toBe(4_500);
		expect(local.calls.at(-1)!.timeoutMs).toBe(1_500);
	});

	it("doesn't fall back for a bad answer, or when the check itself ran out of time", async () => {
		const bad = setup(() => 'cut_off');
		await expect(bad.client.chat(options())).rejects.toMatchObject({ reason: 'cut_off' });
		expect(bad.local.calls).toHaveLength(0);

		const aborted = setup(() => 'timeout');
		const controller = new AbortController();
		controller.abort();
		await expect(aborted.client.chat(options({ signal: controller.signal }))).rejects.toMatchObject({
			reason: 'timeout'
		});
		expect(aborted.local.calls).toHaveLength(0);
	});

	it('fails when neither can answer, so tier 2 fails safe', async () => {
		const { client } = setup(
			() => 'unreachable',
			() => 'unreachable'
		);
		await expect(client.chat(options())).rejects.toMatchObject({ reason: 'unreachable' });
	});
});
