// Overview stats, feed rows and the live feed against the local database (issue #24).
// Uses two throwaway organisations and deletes them afterwards; nothing else is touched.
import type { AgentEvent } from '@safecontext/policy';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeedEvent } from '#lib/feed.ts';
import type { AuthedDevice } from '#lib/server/agent-api/auth.ts';
import { storeEvents } from '#lib/server/agent-api/events.ts';
import { closeListener, subscriberCount } from '#lib/server/event-listener.ts';
import { liveFeedResponse } from '#lib/server/live-feed.ts';
import {
	dailyCounts,
	policyRollout,
	protectedByType,
	recentEvents,
	statsSince
} from '#lib/server/overview.ts';
import { prisma } from '#lib/server/prisma.ts';

const run = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const slugs = [`test-overview-${run}`, `test-overview-other-${run}`];
let mine: AuthedDevice;
let other: AuthedDevice;

async function makeDevice(slug: string): Promise<AuthedDevice> {
	const org = await prisma.organization.create({ data: { slug, name: 'Overview test' } });
	const device = await prisma.device.create({
		data: { organizationId: org.id, deviceId: 'dev-overview' }
	});
	return {
		id: device.id,
		organizationId: org.id,
		deviceId: device.deviceId,
		lastSeenAt: new Date()
	};
}

function agentEvent(extra: Partial<AgentEvent> = {}): AgentEvent {
	return {
		ts: new Date().toISOString(),
		deviceId: 'dev-overview',
		policyVersion: 1,
		hookEvent: 'PostToolUse',
		toolName: 'Read',
		counts: {},
		actions: {},
		blocked: false,
		latencyMs: 12,
		...extra
	};
}

beforeAll(async () => {
	mine = await makeDevice(slugs[0]!);
	other = await makeDevice(slugs[1]!);
});

afterAll(async () => {
	await closeListener();
	await prisma.organization.deleteMany({ where: { slug: { in: slugs } } });
});

describe('stats and feed rows', () => {
	beforeAll(async () => {
		const eightDaysAgo = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
		await storeEvents(mine, {
			events: [
				agentEvent(), // safe
				agentEvent({ counts: { 'customer-names': 1 }, actions: { pseudonymize: 1 } }), // vague
				agentEvent({ actions: { block: 1 } }), // vague: withheld from the output
				agentEvent({
					hookEvent: 'UserPromptSubmit',
					toolName: undefined,
					actions: { block: 1 },
					blocked: true
				}), // blocked
				agentEvent({ ts: eightDaysAgo }) // outside the window
			]
		});
		await storeEvents(other, { events: [agentEvent({ deviceId: 'dev-overview' })] });
	});

	it('counts the last 7 days by result, for one organisation only', async () => {
		const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
		expect(await statsSince(mine.organizationId, since)).toEqual({
			checked: 4,
			safe: 1,
			vague: 2,
			blocked: 1
		});
	});

	it('lists the latest events, newest first, with metadata only', async () => {
		const events = await recentEvents(mine.organizationId);
		expect(events).toHaveLength(5);
		expect(events.at(-1)?.result).toBe('safe'); // the 8-day-old one
		const keys = Object.keys(FeedEvent.shape).sort();
		for (const e of events) expect(Object.keys(e).sort()).toEqual(keys);
		const prompt = events.find((e) => e.hookEvent === 'UserPromptSubmit');
		expect(prompt).toMatchObject({ toolName: null, result: 'blocked', deviceId: 'dev-overview' });
	});

	it('counts checks per UTC day for the last 7 days, today last (#96)', async () => {
		const now = new Date();
		const days = await dailyCounts(mine.organizationId, now);
		expect(days).toHaveLength(7);
		expect(days.at(-1)).toEqual({
			day: now.toISOString().slice(0, 10),
			safe: 1,
			vague: 2,
			blocked: 1
		});
		// The 8-day-old check is before the first day shown.
		expect(days.slice(0, -1).every((d) => d.safe + d.vague + d.blocked === 0)).toBe(true);
	});

	it('counts items found per data type in the window, counts only (#96)', async () => {
		const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
		// This organisation has no data type rows, so the name falls back to the id.
		expect(await protectedByType(mine.organizationId, since)).toEqual([
			{ key: 'customer-names', name: 'customer-names', tier: null, count: 1 }
		]);
		await prisma.dataType.create({
			data: {
				organizationId: mine.organizationId,
				key: 'customer-names',
				name: 'Customer names',
				description: '',
				examples: [],
				tier: 'yellow',
				action: 'pseudonymize'
			}
		});
		expect(await protectedByType(mine.organizationId, since)).toEqual([
			{ key: 'customer-names', name: 'Customer names', tier: 'yellow', count: 1 }
		]);
	});

	it('says how many devices run the latest published policy (#96)', async () => {
		expect(await policyRollout(mine.organizationId)).toEqual({
			version: null,
			current: 0,
			devices: 1
		});
		const snapshot = { version: 1 };
		await prisma.policyVersion.create({
			data: { organizationId: mine.organizationId, version: 1, failMode: 'block', snapshot }
		});
		// The device's last check used policy version 1.
		expect(await policyRollout(mine.organizationId)).toEqual({
			version: 1,
			current: 1,
			devices: 1
		});
		await prisma.policyVersion.create({
			data: { organizationId: mine.organizationId, version: 2, failMode: 'block', snapshot }
		});
		expect(await policyRollout(mine.organizationId)).toMatchObject({ version: 2, current: 0 });
	});
});

describe('live feed', () => {
	/** Reads server-sent events until one has `data:`, or gives up after `ms`. */
	async function nextData(reader: ReadableStreamDefaultReader<Uint8Array>, ms: number) {
		const decoder = new TextDecoder();
		let buffer = '';
		const deadline = Date.now() + ms;
		while (Date.now() < deadline) {
			const chunk = await Promise.race([
				reader.read(),
				new Promise<null>((r) => setTimeout(() => r(null), deadline - Date.now()))
			]);
			if (!chunk || chunk.done) break;
			buffer += decoder.decode(chunk.value, { stream: true });
			for (const message of buffer.split('\n\n').slice(0, -1)) {
				const data = message.split('\n').find((line) => line.startsWith('data: '));
				if (data) return JSON.parse(data.slice('data: '.length)) as unknown;
			}
		}
		return null;
	}

	it('streams a new event within 1 s, and only the organisation’s own', async () => {
		const abort = new AbortController();
		const res = await liveFeedResponse(mine.organizationId, abort.signal);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/event-stream');
		const reader = res.body!.getReader();

		try {
			await storeEvents(other, { events: [agentEvent()] });
			const started = Date.now();
			await storeEvents(mine, { events: [agentEvent({ toolName: 'Bash', actions: { mask: 1 } })] });

			const received = FeedEvent.parse(await nextData(reader, 1000));
			expect(Date.now() - started).toBeLessThan(1000);
			expect(received).toMatchObject({
				toolName: 'Bash',
				result: 'vague',
				deviceId: 'dev-overview'
			});
			const stored = await prisma.event.findUniqueOrThrow({ where: { id: received.id } });
			expect(stored.organizationId).toBe(mine.organizationId);
		} finally {
			abort.abort();
			await reader.cancel().catch(() => {});
		}
	});

	it('stops listening when the browser disconnects', async () => {
		const before = subscriberCount();
		const abort = new AbortController();
		const res = await liveFeedResponse(mine.organizationId, abort.signal);
		expect(subscriberCount()).toBe(before + 1);
		abort.abort();
		expect(subscriberCount()).toBe(before);
		await res.body?.cancel();
	});

	it('does not keep listening if the browser left while it was subscribing', async () => {
		const before = subscriberCount();
		const abort = new AbortController();
		const pending = liveFeedResponse(mine.organizationId, abort.signal);
		abort.abort(); // before `subscribe` has resolved
		const res = await pending;
		expect(res.status).toBe(204);
		expect(subscriberCount()).toBe(before);
	});
});
