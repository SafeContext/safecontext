import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { checkout } from './routes/checkout.ts';
import { invoices } from './routes/invoices.ts';
import { requestLogger } from './lib/logger.ts';

const app = new Hono();
app.use('*', requestLogger);
app.route('/checkout', checkout);
app.route('/invoices', invoices);
app.get('/health', (c) => c.json({ ok: true }));

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) });
