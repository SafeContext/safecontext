// Browser side of admin sign-in (issue #19). Talks to Better Auth's endpoints under /api/auth on
// this site, which `hooks.server.ts` hands to Better Auth (with its sign-in rate limit).
import { createAuthClient } from 'better-auth/client';

export const authClient = createAuthClient();
