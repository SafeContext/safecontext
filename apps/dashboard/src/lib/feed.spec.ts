import { describe, expect, it } from 'vitest';
import {
	addToStats,
	emptyStats,
	eventResult,
	FeedEvent,
	mergeFeed,
	parseFeedMessage,
	timeAgo,
	toolLabel,
	addToDays,
	emptyDays,
	weekday
} from './feed.ts';

const none = { generalize: 0, pseudonymize: 0, mask: 0, block: 0 };

function feedEvent(n: number, extra: Partial<FeedEvent> = {}): FeedEvent {
	const ts = new Date(Date.UTC(2026, 9, 27, 12, 0, n)).toISOString();
	return {
		id: `0199f000-0000-7000-8000-${n.toString().padStart(12, '0')}`,
		ts,
		receivedAt: ts,
		hookEvent: 'PostToolUse',
		toolName: 'Read',
		deviceId: 'dev-a1b2c3',
		result: 'safe',
		...extra
	};
}

describe('eventResult', () => {
	it('is blocked when the check blocked, whatever else happened', () => {
		expect(eventResult(true, none)).toBe('blocked');
		expect(eventResult(true, { ...none, mask: 2 })).toBe('blocked');
	});

	it('is vague when anything was changed or withheld', () => {
		for (const action of ['generalize', 'pseudonymize', 'mask', 'block'] as const) {
			expect(eventResult(false, { ...none, [action]: 1 })).toBe('vague');
		}
	});

	it('is safe when nothing needed changing', () => {
		expect(eventResult(false, none)).toBe('safe');
	});
});

describe('FeedEvent', () => {
	it('rejects any extra field, so no text can ride along', () => {
		expect(() => FeedEvent.parse({ ...feedEvent(1), prompt: 'secret roadmap' })).toThrow();
	});
});

describe('parseFeedMessage', () => {
	it('reads a valid message', () => {
		expect(parseFeedMessage(JSON.stringify(feedEvent(1)))).toEqual(feedEvent(1));
	});

	it('ignores malformed JSON and invalid events instead of throwing', () => {
		for (const data of ['', '{', 'not json', 'null', '{"id":"x"}']) {
			expect(parseFeedMessage(data)).toBeNull();
		}
		expect(parseFeedMessage(JSON.stringify({ ...feedEvent(1), prompt: 'secret' }))).toBeNull();
	});
});

describe('addToStats', () => {
	it('counts each event once, by result', () => {
		const stats = addToStats(emptyStats(), [
			feedEvent(1),
			feedEvent(2, { result: 'vague' }),
			feedEvent(3, { result: 'blocked' }),
			feedEvent(4, { result: 'vague' })
		]);
		expect(stats).toEqual({ checked: 4, safe: 1, vague: 2, blocked: 1 });
	});
});

describe('mergeFeed', () => {
	it('sorts newest first, drops duplicates and caps the length', () => {
		const merged = mergeFeed([feedEvent(5), feedEvent(2)], [feedEvent(5), feedEvent(9)], 2);
		expect(merged.map((e) => e.id)).toEqual([feedEvent(9).id, feedEvent(5).id]);
	});
});

describe('toolLabel', () => {
	it('says "Prompt" for prompt checks and the tool name otherwise', () => {
		expect(toolLabel({ hookEvent: 'UserPromptSubmit', toolName: null })).toBe('Prompt');
		expect(toolLabel({ hookEvent: 'PreToolUse', toolName: 'mcp__slack__post' })).toBe(
			'mcp__slack__post'
		);
	});
});

describe('timeAgo', () => {
	const now = Date.parse('2026-10-27T12:00:00Z');
	it.each([
		['2026-10-27T11:59:58Z', 'just now'],
		['2026-10-27T11:59:30Z', '30 s ago'],
		['2026-10-27T11:56:00Z', '4 min ago'],
		['2026-10-27T09:00:00Z', '3 h ago'],
		['2026-10-25T12:00:00Z', '2 d ago'],
		['2026-10-27T12:00:05Z', 'just now']
	])('%s -> %s', (iso, expected) => {
		expect(timeAgo(iso, now)).toBe(expected);
	});
});

describe('checks per day (#96)', () => {
	const now = new Date('2026-11-12T20:00:00Z');
	const event = (ts: string, result: FeedEvent['result']): FeedEvent => ({
		id: '0199f000-0000-7000-8000-000000000001',
		ts,
		receivedAt: ts,
		hookEvent: 'PostToolUse',
		toolName: 'Read',
		deviceId: 'dev-a1b2c3',
		result
	});

	it('lists the last 7 UTC days, oldest first, today last', () => {
		const days = emptyDays(now);
		expect(days.map((d) => d.day)).toEqual([
			'2026-11-06',
			'2026-11-07',
			'2026-11-08',
			'2026-11-09',
			'2026-11-10',
			'2026-11-11',
			'2026-11-12'
		]);
		expect(days[0]).toEqual({ day: '2026-11-06', safe: 0, vague: 0, blocked: 0 });
	});

	it('adds live events to their day, ignoring ones outside the chart', () => {
		const days = addToDays(emptyDays(now), [
			event('2026-11-12T19:59:00.000Z', 'blocked'),
			event('2026-11-12T00:00:00.000Z', 'vague'),
			event('2026-11-01T10:00:00.000Z', 'safe')
		]);
		expect(days.at(-1)).toEqual({ day: '2026-11-12', safe: 0, vague: 1, blocked: 1 });
		expect(days.slice(0, -1).every((d) => d.safe + d.vague + d.blocked === 0)).toBe(true);
	});

	it('names the weekday in UTC', () => {
		expect(weekday('2026-11-12')).toBe('Thu');
	});
});
