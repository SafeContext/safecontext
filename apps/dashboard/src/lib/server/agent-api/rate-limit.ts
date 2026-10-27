// In-memory token-bucket rate limiting. Per server process: fine for one dashboard instance
// (the pilot). Several instances behind a load balancer would each keep their own buckets.

type Bucket = { tokens: number; at: number };

export class RateLimiter {
	readonly #buckets = new Map<string, Bucket>();
	readonly #refillPerMs: number;
	readonly capacity: number;
	readonly now: () => number;

	/**
	 * @param capacity Burst size: requests allowed back to back.
	 * @param perMinute Sustained rate the bucket refills at.
	 * @param now Clock (tests pass a fake one).
	 */
	constructor(capacity: number, perMinute: number, now: () => number = Date.now) {
		this.capacity = capacity;
		this.now = now;
		this.#refillPerMs = perMinute / 60_000;
	}

	#bucket(key: string): Bucket {
		const now = this.now();
		const b = this.#buckets.get(key);
		if (!b) {
			const fresh = { tokens: this.capacity, at: now };
			this.#buckets.set(key, fresh);
			if (this.#buckets.size > 10_000) this.#sweep();
			return fresh;
		}
		b.tokens = Math.min(this.capacity, b.tokens + (now - b.at) * this.#refillPerMs);
		b.at = now;
		return b;
	}

	#retryAfter(b: Bucket): number {
		return Math.max(1, Math.ceil((1 - b.tokens) / this.#refillPerMs / 1000));
	}

	/** Uses one request. Returns 0 if allowed, otherwise the seconds to wait (`Retry-After`). */
	take(key: string): number {
		const b = this.#bucket(key);
		if (b.tokens >= 1) {
			b.tokens -= 1;
			return 0;
		}
		return this.#retryAfter(b);
	}

	/** Like `take`, but doesn't use a request. */
	check(key: string): number {
		const b = this.#bucket(key);
		return b.tokens >= 1 ? 0 : this.#retryAfter(b);
	}

	/** Forgets every bucket (tests). */
	reset(): void {
		this.#buckets.clear();
	}

	/** Drops buckets that have refilled completely: they behave exactly like a missing one. */
	#sweep(): void {
		const now = this.now();
		for (const [key, b] of this.#buckets) {
			if (b.tokens + (now - b.at) * this.#refillPerMs >= this.capacity) this.#buckets.delete(key);
		}
	}
}

/**
 * The limits for the agent API. Agents poll the policy every few seconds to a minute and upload
 * events in batches, so these leave plenty of headroom for a well-behaved agent.
 */
export const limits = {
	/** Per client IP. Registration happens once per device (or after losing its token). */
	register: new RateLimiter(10, 10),
	/** Per client IP: failed authentications (bad token or enrollment key). */
	authFailures: new RateLimiter(20, 20),
	/** Per device. */
	policy: new RateLimiter(30, 30),
	/** Per device. */
	events: new RateLimiter(30, 60)
};

export function resetRateLimits(): void {
	for (const limiter of Object.values(limits)) limiter.reset();
}
