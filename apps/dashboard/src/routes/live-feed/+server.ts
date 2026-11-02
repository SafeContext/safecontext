// GET /live-feed: new events for the Overview page, as server-sent events (issue #24).
// Metadata only (`FeedEvent`); never any prompt, file or tool text.
import { currentOrganization } from '#lib/server/current-org.ts';
import { liveFeedResponse } from '#lib/server/live-feed.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ request }) => {
	const org = await currentOrganization();
	return liveFeedResponse(org.id, request.signal);
};
