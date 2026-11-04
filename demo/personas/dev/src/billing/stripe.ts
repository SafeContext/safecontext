import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY ?? '', { timeout: 8_000 });

export async function chargeCard(paymentMethodId: string, amountPence: number) {
	const intent = await stripe.paymentIntents.create({
		amount: amountPence,
		currency: 'gbp',
		payment_method: paymentMethodId,
		confirm: true,
		automatic_payment_methods: { enabled: true, allow_redirects: 'never' }
	});
	return {
		id: intent.id,
		status: intent.status,
		declineCode: intent.last_payment_error?.decline_code
	};
}
