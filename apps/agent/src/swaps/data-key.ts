/**
 * The key that encrypts saved placeholder keys (issue #85): 32 random bytes, kept in the login
 * Keychain and made on first use. Never logged or written anywhere else.
 */
import { randomBytes } from 'node:crypto';
import { KEYCHAIN_SERVICE, keychainTokenStore, type TokenStore } from '../sync/token-store.ts';
import { KEY_BYTES } from './vault.ts';

export const VAULT_KEY_ACCOUNT = 'placeholder-key-encryption';

export function keychainVaultKeyStore(): TokenStore {
	return keychainTokenStore({
		service: KEYCHAIN_SERVICE,
		account: VAULT_KEY_ACCOUNT,
		label: 'Safe Context placeholder key encryption'
	});
}

/** The stored key, or a new one saved to the store. Throws if the store can't be read or written. */
export async function loadOrCreateVaultKey(store: TokenStore): Promise<Buffer> {
	const stored = await store.get();
	if (stored !== undefined) {
		const key = Buffer.from(stored, 'base64');
		if (key.length === KEY_BYTES) return key;
	}
	const key = randomBytes(KEY_BYTES);
	await store.set(key.toString('base64'));
	return key;
}
