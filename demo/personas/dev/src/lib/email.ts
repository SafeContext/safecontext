export async function sendEmail(msg: { to: string; subject: string; body: string }) {
	// Staging sends through the mail relay; locally it just prints.
	if (process.env.NODE_ENV !== 'production') {
		console.log(`[email] to=${msg.to} subject=${msg.subject}`);
		return;
	}
	await fetch('https://mail-relay.macrohard.internal/send', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(msg)
	});
}
