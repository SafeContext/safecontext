import { describe, expect, it } from 'vitest';
import { isAgentApiPath, safeRedirectTarget, signInRedirect } from './route-access.ts';

describe('isAgentApiPath', () => {
	it('matches the agent API and nothing else under /api', () => {
		for (const path of ['/api/devices', '/api/policy', '/api/events', '/api/events/']) {
			expect(isAgentApiPath(path), path).toBe(true);
		}
		for (const path of ['/api', '/api/auth/get-session', '/api/policyx', '/policy', '/']) {
			expect(isAgentApiPath(path), path).toBe(false);
		}
	});
});

describe('signInRedirect', () => {
	it('remembers where the visitor was going', () => {
		expect(signInRedirect(new URL('http://x/'))).toBe('/sign-in');
		expect(signInRedirect(new URL('http://x/policy?tab=red'))).toBe(
			'/sign-in?redirectTo=%2Fpolicy%3Ftab%3Dred'
		);
	});
});

describe('safeRedirectTarget', () => {
	it('keeps paths on this site', () => {
		expect(safeRedirectTarget('/policy?tab=red')).toBe('/policy?tab=red');
		expect(safeRedirectTarget('/deploy#key')).toBe('/deploy#key');
	});

	it('sends anything else to Overview', () => {
		for (const target of [
			null,
			'',
			'policy',
			'https://evil.example/',
			'//evil.example/',
			'/\\evil.example/',
			'/\t/evil.example/',
			'javascript:alert(1)',
			'/sign-in',
			'/sign-in?redirectTo=%2F'
		]) {
			expect(safeRedirectTarget(target), String(target)).toBe('/');
		}
	});
});
