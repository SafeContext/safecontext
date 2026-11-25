/**
 * Placeholder keys that outlive the agent, and the local swap record (issue #85).
 */
import { join } from 'node:path';
import type { Logger } from '../log.ts';
import type { TokenStore } from '../sync/token-store.ts';
import { keychainVaultKeyStore, loadOrCreateVaultKey } from './data-key.ts';
import { createFileVault, type KeyVault } from './vault.ts';

export const KEYS_DIR = 'keys';
/** How often saved keys past their 12 hours are deleted while the agent runs. */
const SWEEP_MS = 60 * 60 * 1000;

export interface OpenedVault {
	vault: KeyVault;
	close(): void;
}

/**
 * The vault in `<stateDir>/keys`, with its key from the Keychain (`keyStore`; null: none).
 * Undefined (and `vault_off` logged) when there is no Keychain or it can't be used: keys then last until the agent stops,
 * as before #85. Never throws.
 */
export async function openVault(
	stateDir: string,
	logger: Logger,
	keyStore: TokenStore | null = process.platform === 'darwin' ? keychainVaultKeyStore() : null
): Promise<OpenedVault | undefined> {
	if (!keyStore) {
		logger.log('warn', 'vault_off');
		return undefined;
	}
	try {
		const key = await loadOrCreateVaultKey(keyStore);
		const vault = createFileVault({
			dir: join(stateDir, KEYS_DIR),
			key,
			onError: (code) => logger.log('error', code)
		});
		logger.log('info', 'vault_ready', { deleted: vault.sweep() });
		const timer = setInterval(() => vault.sweep(), SWEEP_MS);
		timer.unref();
		return { vault, close: () => clearInterval(timer) };
	} catch {
		logger.log('warn', 'vault_off');
		return undefined;
	}
}
