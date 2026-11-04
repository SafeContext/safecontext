import { Hono } from 'hono';
import { chargeCard } from '../billing/stripe.ts';
import { createOrder } from '../db/orders.ts';

export const checkout = new Hono();

checkout.post('/', async (c) => {
	const body = await c.req.json<{
		accountId: string;
		email: string;
		amountPence: number;
		paymentMethodId: string;
	}>();

	if (!Number.isInteger(body.amountPence) || body.amountPence <= 0) {
		return c.json({ error: 'invalid_amount' }, 400);
	}

	// TODO(orders-412): retries double-charge when Stripe times out. Needs an idempotency key.
	const charge = await chargeCard(body.paymentMethodId, body.amountPence);
	if (charge.status !== 'succeeded') {
		return c.json({ error: 'card_declined', code: charge.declineCode }, 402);
	}

	const order = await createOrder({ accountId: body.accountId, email: body.email, chargeId: charge.id });
	return c.json(order, 201);
});
