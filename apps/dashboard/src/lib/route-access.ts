// Which paths need a signed-in admin, and where sign-in sends people back to (issue #19).
// Shared by `hooks.server.ts` and the sign-in page. No server-only imports.

export const SIGN_IN_PATH = '/sign-in';

/** Agent API routes (`src/routes/api/`). They authenticate with device tokens, not sessions. */
const AGENT_API_PATHS = ['/api/devices', '/api/policy', '/api/events'];

export const isAgentApiPath = (pathname: string) =>
	AGENT_API_PATHS.some((base) => pathname === base || pathname.startsWith(`${base}/`));

/** Where to send a signed-out visitor so they come back to `url` after signing in. */
export function signInRedirect(url: URL): string {
	const back = url.pathname + url.search;
	return back === '/' ? SIGN_IN_PATH : `${SIGN_IN_PATH}?redirectTo=${encodeURIComponent(back)}`;
}

/**
 * The page to open after signing in: `redirectTo` if it is a path on this site, else Overview.
 * Anything else (another site, `//host`, `/\host`) is ignored so the link can't send people away.
 */
export function safeRedirectTarget(redirectTo: string | null): string {
	if (!redirectTo || !redirectTo.startsWith('/') || /^\/[/\\]/.test(redirectTo)) return '/';
	if (redirectTo === SIGN_IN_PATH || redirectTo.startsWith(`${SIGN_IN_PATH}?`)) return '/';
	try {
		const url = new URL(redirectTo, 'http://dashboard.invalid');
		if (url.origin !== 'http://dashboard.invalid') return '/';
		return url.pathname + url.search + url.hash;
	} catch {
		return '/';
	}
}
