import type { IconName } from './Icon.svelte';

export const navItems: readonly {
	href: '/' | '/policy' | '/deploy' | '/settings';
	label: string;
	icon: IconName;
}[] = [
	{ href: '/', label: 'Overview', icon: 'overview' },
	{ href: '/policy', label: 'Policy', icon: 'policy' },
	{ href: '/deploy', label: 'Deploy', icon: 'deploy' },
	{ href: '/settings', label: 'Settings', icon: 'settings' }
];
