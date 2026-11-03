/**
 * A minimal OpenAI-compatible chat client for tier 2 (issue #16), with `fetch`. The default is
 * Ollama on this Mac; a company-hosted model server (#75) is the same API at another base URL,
 * with an optional Bearer key.
 *
 * Request (as `ml/prompts/tier2/tier2.json` and `ml/src/safecontext_ml/tier2/client.py`):
 * `POST {baseUrl}/chat/completions`, non-streaming, `temperature: 0`, `seed: 0`,
 * `reasoning_effort: "none"`, and the task's answer schema as `response_format` (Ollama
 * constrains decoding to it). The answer is still checked on the way back (prompts.ts).
 *
 * Never log the messages, the answer or the API key: errors carry only a reason code.
 */
import type { ChatMessage, JsonSchema } from './prompts.ts';

/** Why a call failed. Metadata only, safe to log. */
export type Tier2Reason = 'timeout' | 'unreachable' | 'http_error' | 'bad_response' | 'cut_off' | 'bad_answer';

export class Tier2CallError extends Error {
	constructor(readonly reason: Tier2Reason) {
		super(`tier 2 call failed: ${reason}`);
	}
}

export interface Tier2ClientOptions {
	/** e.g. `http://127.0.0.1:11434/v1` (checked in config.ts: https, or http on loopback). */
	baseUrl: string;
	model: string;
	/** Sent as `Authorization: Bearer <key>` when set. */
	apiKey?: string;
	/** Injected for tests. */
	fetch?: typeof fetch;
}

export interface ChatOptions {
	messages: readonly ChatMessage[];
	schema: JsonSchema;
	maxTokens: number;
	timeoutMs: number;
	/** The check's own abort signal (its time budget ran out). */
	signal?: AbortSignal;
}

export interface Tier2Client {
	readonly baseUrl: string;
	readonly model: string;
	/** The answer text. Throws `Tier2CallError` on any failure. */
	chat(options: ChatOptions): Promise<string>;
	/** Ollama only: is the model pulled, and with which digest? */
	listModels(timeoutMs: number): Promise<Array<{ name: string; digest: string }>>;
}

export function createTier2Client({ baseUrl, model, apiKey, fetch: fetchFn = fetch }: Tier2ClientOptions): Tier2Client {
	const base = baseUrl.replace(/\/+$/, '');
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (apiKey) headers.authorization = `Bearer ${apiKey}`;

	async function request(url: string, init: RequestInit, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
		const timeout = AbortSignal.timeout(Math.max(1, Math.floor(timeoutMs)));
		let res: Response;
		try {
			res = await fetchFn(url, { ...init, headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
		} catch {
			throw new Tier2CallError(timeout.aborted || signal?.aborted ? 'timeout' : 'unreachable');
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			throw new Tier2CallError('http_error');
		}
		try {
			return await res.json();
		} catch {
			throw new Tier2CallError(timeout.aborted || signal?.aborted ? 'timeout' : 'bad_response');
		}
	}

	return {
		baseUrl: base,
		model,

		async chat({ messages, schema, maxTokens, timeoutMs, signal }) {
			const body = {
				model,
				messages,
				temperature: 0,
				max_tokens: maxTokens,
				stream: false,
				seed: 0,
				reasoning_effort: 'none',
				response_format: {
					type: 'json_schema',
					json_schema: { name: schema.title ?? 'answer', schema, strict: true }
				}
			};
			const payload = (await request(
				`${base}/chat/completions`,
				{ method: 'POST', body: JSON.stringify(body) },
				timeoutMs,
				signal
			)) as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> } | null;
			const choice = payload?.choices?.[0];
			const content = choice?.message?.content;
			if (typeof content !== 'string') throw new Tier2CallError('bad_response');
			if (choice?.finish_reason === 'length') throw new Tier2CallError('cut_off');
			return content;
		},

		async listModels(timeoutMs) {
			// Ollama's native API sits next to the OpenAI-compatible /v1.
			const root = base.replace(/\/v1$/, '');
			const payload = (await request(`${root}/api/tags`, { method: 'GET' }, timeoutMs)) as {
				models?: Array<{ name?: unknown; model?: unknown; digest?: unknown }>;
			} | null;
			if (!Array.isArray(payload?.models)) throw new Tier2CallError('bad_response');
			return payload.models.flatMap((m) => {
				const name = typeof m.name === 'string' ? m.name : typeof m.model === 'string' ? m.model : undefined;
				return name === undefined ? [] : [{ name, digest: typeof m.digest === 'string' ? m.digest : '' }];
			});
		}
	};
}
