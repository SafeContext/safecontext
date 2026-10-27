import { describe, expect, it } from 'vitest';
import { keychainTokenStore, memoryTokenStore, type SecurityRunner } from './token-store.ts';

/** Stands in for `/usr/bin/security`, so these tests never touch the real Keychain. */
function fakeSecurity(reply: (args: string[], stdin?: string) => { code: number; stdout?: string }) {
	const calls: Array<{ args: string[]; stdin?: string }> = [];
	const run: SecurityRunner = async (args, stdin) => {
		calls.push({ args, ...(stdin !== undefined && { stdin }) });
		const r = reply(args, stdin);
		return { code: r.code, stdout: r.stdout ?? '' };
	};
	return { run, calls };
}

const opts = { service: 'com.safecontext.agent', account: 'https://dash.example.com' };

describe('memoryTokenStore', () => {
	it('gets, sets and deletes', async () => {
		const store = memoryTokenStore();
		expect(await store.get()).toBeUndefined();
		await store.set('scd_abc');
		expect(await store.get()).toBe('scd_abc');
		await store.delete();
		expect(await store.get()).toBeUndefined();
	});
});

describe('keychainTokenStore', () => {
	it('reads the password of the generic password item', async () => {
		const { run, calls } = fakeSecurity(() => ({ code: 0, stdout: 'scd_abc\n' }));
		expect(await keychainTokenStore({ ...opts, run }).get()).toBe('scd_abc');
		expect(calls).toEqual([{ args: ['find-generic-password', '-s', opts.service, '-a', opts.account, '-w'] }]);
	});

	it('returns undefined when there is no item (exit 44) and throws on other errors', async () => {
		expect(await keychainTokenStore({ ...opts, run: fakeSecurity(() => ({ code: 44 })).run }).get()).toBeUndefined();
		await expect(keychainTokenStore({ ...opts, run: fakeSecurity(() => ({ code: 51 })).run }).get()).rejects.toThrow(
			/51/
		);
	});

	it('writes through stdin, so the token is never a command-line argument', async () => {
		const { run, calls } = fakeSecurity(() => ({ code: 0 }));
		await keychainTokenStore({ ...opts, run }).set('scd_secret-token');
		expect(calls).toHaveLength(1);
		expect(calls[0]!.args).toEqual(['-i']);
		expect(calls[0]!.args.join(' ')).not.toContain('scd_secret-token');
		expect(calls[0]!.stdin).toBe(
			'add-generic-password -U -s "com.safecontext.agent" -a "https://dash.example.com" ' +
				'-l "Safe Context device token" -w "scd_secret-token"\n'
		);
	});

	it('refuses tokens that could break quoting, and reports write failures', async () => {
		const { run, calls } = fakeSecurity(() => ({ code: 0 }));
		const store = keychainTokenStore({ ...opts, run });
		await expect(store.set('a" -X "b')).rejects.toThrow(/unexpected characters/);
		await expect(store.set('a\nb')).rejects.toThrow(/unexpected characters/);
		expect(calls).toHaveLength(0);
		await expect(
			keychainTokenStore({ ...opts, run: fakeSecurity(() => ({ code: 1 })).run }).set('ok')
		).rejects.toThrow();
	});

	it('deletes, ignoring a missing item', async () => {
		const { run, calls } = fakeSecurity(() => ({ code: 44 }));
		await keychainTokenStore({ ...opts, run }).delete();
		expect(calls[0]!.args).toEqual(['delete-generic-password', '-s', opts.service, '-a', opts.account]);
	});

	it('rejects unsafe service or account names', () => {
		expect(() => keychainTokenStore({ service: 'a b', account: 'x' })).toThrow();
		expect(() => keychainTokenStore({ service: 'a', account: 'x"y' })).toThrow();
	});
});
