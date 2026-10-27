/**
 * Where the device token lives. On macOS it goes in the login Keychain (via the `security` CLI);
 * tests use the in-memory store. The token is a secret: never log it or put it on a command line.
 */
import { spawn } from 'node:child_process';

export interface TokenStore {
	/** The stored token, or undefined if there is none. Throws if the store can't be read. */
	get(): Promise<string | undefined>;
	/** Store (or replace) the token. */
	set(token: string): Promise<void>;
	/** Remove the token. No error if there was none. */
	delete(): Promise<void>;
	readonly kind: 'keychain' | 'memory';
}

export function memoryTokenStore(initial?: string): TokenStore & { readonly value: string | undefined } {
	let value = initial;
	return {
		kind: 'memory',
		get value() {
			return value;
		},
		get: async () => value,
		set: async (token) => {
			value = token;
		},
		delete: async () => {
			value = undefined;
		}
	};
}

export interface RunResult {
	code: number;
	stdout: string;
}

/** Runs `/usr/bin/security` with `args`, writing `stdin` to it. Injected so tests never touch the Keychain. */
export type SecurityRunner = (args: string[], stdin?: string) => Promise<RunResult>;

const SECURITY = '/usr/bin/security';
/** `security` exit code when the item doesn't exist (errSecItemNotFound). */
const NOT_FOUND = 44;

export const runSecurity: SecurityRunner = (args, stdin) =>
	new Promise((resolve, reject) => {
		// stderr is ignored: it can echo the command, and in interactive mode that includes the token.
		const child = spawn(SECURITY, args, { stdio: ['pipe', 'pipe', 'ignore'] });
		let stdout = '';
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => (stdout += chunk));
		child.once('error', reject);
		child.once('close', (code) => resolve({ code: code ?? -1, stdout }));
		child.stdin.end(stdin ?? '');
	});

/** Characters a token may contain. Anything else could break quoting in `security -i`. */
const SAFE_TOKEN = /^[A-Za-z0-9_\-.~+/=]{1,512}$/;
const SAFE_LABEL = /^[A-Za-z0-9_\-.:/[\]]{1,256}$/;

export interface KeychainOptions {
	/** Keychain item service name. */
	service: string;
	/** Keychain item account. We use the dashboard's origin, so each dashboard has its own token. */
	account: string;
	run?: SecurityRunner;
}

export const KEYCHAIN_SERVICE = 'com.safecontext.agent';

/**
 * A generic password item in the user's default (login) Keychain.
 * Writing goes through `security -i` with the command on stdin, so the token never appears in
 * the process list the way `security add-generic-password -w <token>` would.
 */
export function keychainTokenStore({ service, account, run = runSecurity }: KeychainOptions): TokenStore {
	if (!SAFE_LABEL.test(service) || !SAFE_LABEL.test(account)) {
		throw new Error('Keychain service and account may only contain URL-safe characters');
	}
	const item = ['-s', service, '-a', account];
	return {
		kind: 'keychain',
		async get() {
			const { code, stdout } = await run(['find-generic-password', ...item, '-w']);
			if (code === NOT_FOUND) return undefined;
			if (code !== 0) throw new Error(`security find-generic-password failed (${code})`);
			const token = stdout.replace(/\n$/, '');
			return token === '' ? undefined : token;
		},
		async set(token) {
			if (!SAFE_TOKEN.test(token)) throw new Error('Device token has unexpected characters');
			const line = `add-generic-password -U -s "${service}" -a "${account}" -l "Safe Context device token" -w "${token}"\n`;
			const { code } = await run(['-i'], line);
			if (code !== 0) throw new Error(`security add-generic-password failed (${code})`);
		},
		async delete() {
			const { code } = await run(['delete-generic-password', ...item]);
			if (code !== 0 && code !== NOT_FOUND) throw new Error(`security delete-generic-password failed (${code})`);
		}
	};
}
