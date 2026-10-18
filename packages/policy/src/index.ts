/**
 * Shared contracts for Safe Context (v1). Single source of truth for:
 * - Policy: written by the dashboard, read by the agent.
 * - AgentEvent: agent -> dashboard. Metadata only, NEVER prompt, file or tool text.
 * - Hook I/O and the agent API: what Claude Code sends to / expects from the agent.
 *
 * JSON Schema copies for Python live in `schema/` (regenerate with `pnpm schema:export`).
 */
export * from './policy.ts';
export * from './defaults.ts';
export * from './events.ts';
export * from './hooks.ts';
export * from './api.ts';
