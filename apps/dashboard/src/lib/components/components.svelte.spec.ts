import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Button from './Button.svelte';
import Card from './Card.svelte';
import EmptyState from './EmptyState.svelte';
import Pill from './Pill.svelte';
import FeedList from './FeedList.svelte';
import StatCard from './StatCard.svelte';

const text = (value: string) => createRawSnippet(() => ({ render: () => `<span>${value}</span>` }));

describe('Button', () => {
	it('renders a button by default', async () => {
		render(Button, { children: text('Save') });
		await expect.element(page.getByRole('button', { name: 'Save' })).toBeInTheDocument();
	});

	it('renders a link when given an href', async () => {
		render(Button, { children: text('Go'), href: '/policy' });
		await expect.element(page.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/policy');
	});
});

describe('Pill', () => {
	it('shows its label', async () => {
		render(Pill, { tone: 'safe', children: text('Safe') });
		await expect.element(page.getByText('Safe')).toBeInTheDocument();
	});
});

describe('Card', () => {
	it('shows a title and content', async () => {
		render(Card, { title: 'Activity', children: text('Body') });
		await expect.element(page.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
		await expect.element(page.getByText('Body')).toBeInTheDocument();
	});
});

describe('EmptyState', () => {
	it('shows title, description and action', async () => {
		render(EmptyState, {
			title: 'Nothing yet',
			description: 'Come back later',
			action: text('Act')
		});
		await expect.element(page.getByRole('heading', { name: 'Nothing yet' })).toBeInTheDocument();
		await expect.element(page.getByText('Come back later')).toBeInTheDocument();
		await expect.element(page.getByText('Act')).toBeInTheDocument();
	});
});

describe('StatCard', () => {
	it('shows its label and a formatted number', async () => {
		render(StatCard, { label: 'Checked', value: 12345, hint: 'Prompts and tool calls' });
		const card = page.getByRole('region', { name: 'Checked' });
		await expect.element(card.getByText('12,345')).toBeInTheDocument();
		await expect.element(card.getByText('Prompts and tool calls')).toBeInTheDocument();
	});
});

describe('FeedList', () => {
	const now = Date.parse('2026-10-27T12:00:00Z');

	it('shows tool, device, time and result for each check', async () => {
		// `events` is also a Svelte mount option, so props go under `props`.
		render(FeedList, {
			props: {
				now,
				events: [
					{
						id: '0199f000-0000-7000-8000-000000000002',
						ts: '2026-10-27T11:56:00.000Z',
						receivedAt: '2026-10-27T11:56:01.000Z',
						hookEvent: 'UserPromptSubmit',
						toolName: null,
						deviceId: 'dev-a1b2c3',
						result: 'blocked'
					},
					{
						id: '0199f000-0000-7000-8000-000000000001',
						ts: '2026-10-27T09:00:00.000Z',
						receivedAt: '2026-10-27T09:00:01.000Z',
						hookEvent: 'PostToolUse',
						toolName: 'Read',
						deviceId: 'dev-d4e5f6',
						result: 'vague'
					}
				]
			}
		});
		const rows = page.getByTestId('feed-row');
		await expect.element(rows.nth(0)).toHaveTextContent(/Prompt.*Blocked.*dev-a1b2c3.*4 min ago/);
		await expect
			.element(rows.nth(1))
			.toHaveTextContent(/Read.*Tool output.*Made vague.*dev-d4e5f6.*3 h ago/);
	});
});
