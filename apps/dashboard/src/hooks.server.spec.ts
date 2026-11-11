// Admin sign-in and protected routes (issue #19), through the real `handle` hook, Better Auth and
// the local database. Uses two throwaway organisations (and their users) and deletes them
// afterwards; nothing else in the database is touched.
import type { RequestEvent } from '@sveltejs/kit';
import { isRedirect } from '@sveltejs/kit';
import { hashPassword } from 'better-auth/crypto';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ensureAdmin } from '#lib/server/admin-accounts.ts';
import { prisma } from '#lib/server/prisma.ts';

// `currentOrganization()` (and Better Auth's cookie plugin) read the request through
// `getRequestEvent()`, which only works inside SvelteKit's server. Point it at our fake event.
const request = vi.hoisted(() => ({ event: undefined as unknown }));
vi.mock('$app/server', () => ({ getRequestEvent: () => request.event }));

const { handle } = await import('./hooks.server.ts');
const { currentOrganization } = await import('#lib/server/current-org.ts');
const { load: layoutLoad } = await import('./routes/+layout.server.ts');

const run = `${Date.now().toString(36)}-${randomBytes(3).toString('hex')}`;
const slugs = [`test-auth-${run}-a`, `test-auth-${run}-b`];
const email = (who: string) => `${who}-${run}@auth-test.example`;
const password = () => randomBytes(18).toString('base64url');

type Org = { id: string; name: string };
const orgs: Org[] = [];
const admins: { email: string; password: string }[] = [];

beforeAll(async () => {
	for (const [i, slug] of slugs.entries()) {
		const org = await prisma.organization.create({
			data: { slug, name: `Auth test ${i}` },
			select: { id: true, name: true }
		});
		orgs.push(org);
		const admin = { email: email(`admin${i}`), password: password() };
		await ensureAdmin(prisma, { organizationId: org.id, name: `Admin ${i}`, ...admin });
		admins.push(admin);
	}
});

afterAll(async () => {
	await prisma.organization.deleteMany({ where: { slug: { in: slugs } } });
	await prisma.user.deleteMany({ where: { email: { endsWith: `-${run}@auth-test.example` } } });
});

function fakeEvent(path: string, cookie?: string): RequestEvent {
	const url = new URL(path, 'http://localhost');
	return {
		url,
		request: new Request(url, { headers: cookie ? { cookie } : {} }),
		locals: {},
		cookies: { set: () => {}, get: () => undefined, getAll: () => [], delete: () => {} },
		getClientAddress: () => '192.0.2.10'
	} as unknown as RequestEvent;
}

type Outcome = { event: RequestEvent; resolved: boolean; response?: Response; location?: string };

/** Sends a request through `handle`. `inside` runs where a page's load function would. */
async function send(
	path: string,
	cookie?: string,
	inside?: (event: RequestEvent) => unknown
): Promise<Outcome> {
	const event = fakeEvent(path, cookie);
	request.event = event;
	let resolved = false;
	try {
		const response = await handle({
			event,
			resolve: async (e) => {
				resolved = true;
				await inside?.(e);
				return new Response('page');
			}
		});
		return { event, resolved, response };
	} catch (e) {
		if (isRedirect(e)) return { event, resolved, location: e.location };
		throw e;
	}
}

/** Signs in through Better Auth's HTTP endpoint (as the sign-in page does). Returns the cookie. */
async function signIn(user: { email: string; password: string }) {
	const res = await handle({
		event: {
			...fakeEvent('/api/auth/sign-in/email'),
			request: new Request('http://localhost/api/auth/sign-in/email', {
				method: 'POST',
				headers: { 'content-type': 'application/json', origin: 'http://localhost' },
				body: JSON.stringify(user)
			})
		} as RequestEvent,
		resolve: () => {
			throw new Error('Better Auth requests should not reach the app');
		}
	});
	const cookie = res.headers
		.getSetCookie()
		.map((c) => c.split(';')[0])
		.join('; ');
	return { status: res.status, cookie };
}

describe('signed out', () => {
	it.each(['/', '/policy', '/deploy', '/settings', '/live-feed'])(
		'%s redirects to sign-in',
		async (path) => {
			const out = await send(path);
			expect(out.resolved).toBe(false);
			expect(out.location).toBe(
				path === '/' ? '/sign-in' : `/sign-in?redirectTo=${encodeURIComponent(path)}`
			);
		}
	);

	it('keeps the query string for after sign-in', async () => {
		expect((await send('/policy?tab=red')).location).toBe(
			'/sign-in?redirectTo=%2Fpolicy%3Ftab%3Dred'
		);
	});

	it('can open the sign-in page', async () => {
		const out = await send('/sign-in');
		expect(out.resolved).toBe(true);
		expect(out.event.locals.admin).toBeUndefined();
	});

	it('leaves the agent API to its device tokens', async () => {
		for (const path of ['/api/devices', '/api/policy', '/api/events']) {
			const out = await send(path);
			expect(out.resolved, path).toBe(true);
			expect(out.event.locals.admin, path).toBeUndefined();
		}
	});

	it('pages refuse rather than guess an organisation', async () => {
		request.event = fakeEvent('/api/policy');
		expect(() => currentOrganization()).toThrow();
	});

	it('a made-up session cookie counts as signed out', async () => {
		const out = await send('/', 'better-auth.session_token=forged.value');
		expect(out.location).toBe('/sign-in');
	});
});

describe('signing in', () => {
	it('rejects a wrong password', async () => {
		const res = await signIn({ email: admins[0]!.email, password: 'not-the-password' });
		expect(res.status).toBe(401);
	});

	it('cannot sign up from the browser', async () => {
		const res = await handle({
			event: {
				...fakeEvent('/api/auth/sign-up/email'),
				request: new Request('http://localhost/api/auth/sign-up/email', {
					method: 'POST',
					headers: { 'content-type': 'application/json', origin: 'http://localhost' },
					body: JSON.stringify({ email: email('intruder'), password: password(), name: 'x' })
				})
			} as RequestEvent,
			resolve: async () => new Response('app')
		});
		expect(res.status).toBe(400);
		expect(await prisma.user.findUnique({ where: { email: email('intruder') } })).toBeNull();
	});

	it('each admin sees only their own organisation', async () => {
		for (const [i, admin] of admins.entries()) {
			const { status, cookie } = await signIn(admin);
			expect(status).toBe(200);

			let seen: Org | undefined;
			const out = await send('/policy', cookie, () => {
				seen = currentOrganization();
			});
			expect(out.resolved).toBe(true);
			expect(seen).toEqual(orgs[i]);

			const layout = (await layoutLoad(out.event as never)) as { admin: unknown };
			expect(layout.admin).toEqual({
				email: admin.email,
				name: `Admin ${i}`,
				organizationName: orgs[i]!.name
			});
		}
	});

	it('the sign-in page sees a signed-in admin', async () => {
		const { cookie } = await signIn(admins[0]!);
		const out = await send('/sign-in', cookie);
		expect(out.event.locals.admin?.organization.id).toBe(orgs[0]!.id);
	});
});

describe('linking a Member at first sign-in', () => {
	/** A sign-in account with no Member linked yet (what an SSO sign-in would look like). */
	async function bareUser(address: string) {
		const id = randomUUID();
		const pw = password();
		await prisma.user.create({ data: { id, email: address, name: 'Bare' } });
		await prisma.account.create({
			data: {
				id: randomUUID(),
				userId: id,
				providerId: 'credential',
				accountId: id,
				password: await hashPassword(pw)
			}
		});
		return { id, email: address, password: pw };
	}

	it('fills in Member.userId by matching email, ignoring case', async () => {
		const user = await bareUser(email('new'));
		const member = await prisma.member.create({
			data: { organizationId: orgs[1]!.id, email: user.email.toUpperCase() }
		});

		const { status, cookie } = await signIn(user);
		expect(status).toBe(200);
		expect((await prisma.member.findUnique({ where: { id: member.id } }))?.userId).toBe(user.id);

		let seen: Org | undefined;
		await send('/', cookie, () => {
			seen = currentOrganization();
		});
		expect(seen?.id).toBe(orgs[1]!.id);
	});

	it('refuses someone who is no organisation’s admin', async () => {
		const user = await bareUser(email('stranger'));
		expect((await signIn(user)).status).toBe(401);
		expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
	});

	it('refuses to guess when the email is unlinked in two organisations', async () => {
		const user = await bareUser(email('both'));
		for (const org of orgs) {
			await prisma.member.create({ data: { organizationId: org.id, email: user.email } });
		}
		expect((await signIn(user)).status).toBe(401);
		expect(await prisma.member.count({ where: { userId: user.id } })).toBe(0);
	});

	it('a removed admin is signed out on their next request', async () => {
		const admin = { email: email('removed'), password: password() };
		await ensureAdmin(prisma, { organizationId: orgs[0]!.id, name: 'Removed', ...admin });
		const { cookie } = await signIn(admin);
		expect((await send('/', cookie)).resolved).toBe(true);

		await prisma.member.deleteMany({ where: { email: admin.email } });
		expect((await send('/', cookie)).location).toBe('/sign-in');
	});
});

describe('ensureAdmin', () => {
	it('keeps an existing password unless asked to reset it', async () => {
		const admin = admins[0]!;
		const base = { organizationId: orgs[0]!.id, name: 'Admin 0', email: admin.email };
		expect(await ensureAdmin(prisma, { ...base, password: password() })).toBe(false);
		expect((await signIn(admin)).status).toBe(200);

		const next = password();
		expect(await ensureAdmin(prisma, { ...base, password: next, resetPassword: true })).toBe(true);
		expect((await signIn(admin)).status).toBe(401);
		admin.password = next;
		expect((await signIn(admin)).status).toBe(200);
	});

	it('rejects short passwords', async () => {
		await expect(
			ensureAdmin(prisma, {
				organizationId: orgs[0]!.id,
				name: 'Short',
				email: email('short'),
				password: 'short'
			})
		).rejects.toThrow(/at least/);
	});
});
