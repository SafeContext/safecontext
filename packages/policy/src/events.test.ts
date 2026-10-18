import { describe, expect, it } from 'vitest';
import { AgentEvent, AgentEventBatch } from './events.ts';

const event = () => ({
	ts: '2026-10-17T12:00:00.000Z',
	deviceId: 'device-7f3a',
	policyVersion: 4,
	hookEvent: 'PostToolUse',
	toolName: 'Read',
	counts: { 'customer-personal-data': 3, secrets: 1 },
	actions: { pseudonymize: 3, block: 1 },
	blocked: false,
	latencyMs: 42.5
});

describe('AgentEvent', () => {
	it('accepts a valid event', () => {
		expect(AgentEvent.parse(event()).counts.secrets).toBe(1);
	});

	it('rejects any extra field, so text can never sneak in', () => {
		expect(AgentEvent.safeParse({ ...event(), prompt: 'Q3 revenue was $4.2M' }).success).toBe(false);
		expect(AgentEvent.safeParse({ ...event(), text: 'jane@northwind.com' }).success).toBe(false);
	});

	it('rejects free text as a count key or tool name', () => {
		expect(AgentEvent.safeParse({ ...event(), counts: { 'jane@northwind.com': 1 } }).success).toBe(false);
		expect(AgentEvent.safeParse({ ...event(), toolName: 'Read secret.txt' }).success).toBe(false);
	});

	it('rejects unknown actions and negative counts', () => {
		expect(AgentEvent.safeParse({ ...event(), actions: { delete: 1 } }).success).toBe(false);
		expect(AgentEvent.safeParse({ ...event(), counts: { secrets: -1 } }).success).toBe(false);
	});

	it('allows a prompt event without a tool name', () => {
		const { toolName: _toolName, ...prompt } = event();
		expect(AgentEvent.safeParse({ ...prompt, hookEvent: 'UserPromptSubmit' }).success).toBe(true);
	});
});

describe('AgentEventBatch', () => {
	it('needs 1 to 500 events', () => {
		expect(AgentEventBatch.safeParse({ events: [] }).success).toBe(false);
		expect(AgentEventBatch.safeParse({ events: [event()] }).success).toBe(true);
	});
});
