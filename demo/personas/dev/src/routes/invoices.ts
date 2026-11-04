import { Hono } from 'hono';
import { getInvoice, markSent } from '../db/orders.ts';
import { sendEmail } from '../lib/email.ts';

export const invoices = new Hono();

invoices.post('/:id/send', async (c) => {
	const invoice = await getInvoice(c.req.param('id'));
	if (!invoice) return c.json({ error: 'not_found' }, 404);

	await sendEmail({
		to: invoice.billingEmail,
		subject: `Your Macrohard invoice ${invoice.number}`,
		body: `Hi,\n\nYour invoice for ${invoice.total} is attached.\n\nMacrohard Billing`
	});
	await markSent(invoice.id);
	return c.json({ sent: true });
});
