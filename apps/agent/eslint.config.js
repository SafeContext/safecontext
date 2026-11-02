import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import ts from 'typescript-eslint';

export default defineConfig(js.configs.recommended, ts.configs.recommended, {
	rules: {
		// Unused names starting with "_" are deliberate (e.g. dropping a field in a test).
		'@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
	}
});
