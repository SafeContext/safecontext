import { page } from 'vitest/browser';
import { describe, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createRawSnippet } from 'svelte';
import Button from './Button.svelte';
import Card from './Card.svelte';
import EmptyState from './EmptyState.svelte';
import Pill from './Pill.svelte';

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
