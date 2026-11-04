import type { MiddlewareHandler } from 'hono';

// Logs every request. On errors it also logs the request body, which is how card numbers and
// customer emails ended up in logs/checkout-errors.log (see orders-415).
export const requestLogger: MiddlewareHandler = async (c, next) => {
	const started = performance.now();
	await next();
	const ms = Math.round(performance.now() - started);
	const line = `${new Date().toISOString()} ${c.req.method} ${c.req.path} ${c.res.status} ${ms}ms`;
	if (c.res.status >= 400) {
		const body = await c.req.raw.clone().text().catch(() => '');
		console.error(`${line} body=${body}`);
	} else {
		console.log(line);
	}
};
