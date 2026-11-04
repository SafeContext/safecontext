import pg from 'pg';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function createOrder(o: { accountId: string; email: string; chargeId: string }) {
	const { rows } = await pool.query(
		'insert into orders (account_id, email, charge_id) values ($1, $2, $3) returning id, created_at',
		[o.accountId, o.email, o.chargeId]
	);
	return rows[0];
}

export async function getInvoice(id: string) {
	const { rows } = await pool.query(
		'select id, number, total, billing_email as "billingEmail" from invoices where id = $1',
		[id]
	);
	return rows[0] as { id: string; number: string; total: string; billingEmail: string } | undefined;
}

export async function markSent(id: string) {
	await pool.query('update invoices set sent_at = now() where id = $1', [id]);
}
