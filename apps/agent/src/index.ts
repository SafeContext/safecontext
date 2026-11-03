import { createApp } from './app.ts';
import { createClassifier } from './classifier/classifier.ts';
import { createTier0, termListDetectors } from './classifier/tier0.ts';
import { tier1FromConfig } from './classifier/tier1/tier1.ts';
import { tier2FromConfig } from './classifier/tier2/tier2.ts';
import { readConfig } from './config.ts';
import { jsonLogger } from './log.ts';
import { filePolicySource } from './policy-source.ts';
import { startServer } from './server.ts';
import { startSync } from './sync/index.ts';

const config = readConfig();
const logger = jsonLogger();
const localPolicy = filePolicySource(config.policyFile, logger);
// With SC_DASHBOARD_URL set: pull the policy (cached on disk, so it works offline) and upload events.
const sync = config.sync && startSync(config.sync, { logger, fallback: localPolicy });
const policy = sync?.policy ?? localPolicy;
// Tier 1 (#15) loads in the background; checks wait for it within their budget.
const tier1 = tier1FromConfig(config.tier1, logger);
// Tier 2 (#16) checks its model server in the background; until it answers, its calls fail safe.
const tier2 = tier2FromConfig(config.tier2, logger);
const classifier = createClassifier({
	tiers: [
		createTier0({ policyDetectors: termListDetectors }),
		...(tier1 ? [tier1] : []),
		...(tier2 ? [tier2.tier] : [])
	],
	budgetMs: config.checkBudgetMs
});

const app = createApp({
	policy,
	classifier,
	logger,
	events: sync?.events,
	generalizer: tier2?.generalizer,
	checkBudgetMs: config.checkBudgetMs
});
const server = await startServer(app, config.port);
logger.log('info', 'listening', { port: server.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		void Promise.all([server.close(), sync ? sync.close() : policy.close?.(), tier1?.close()]).finally(() =>
			process.exit(0)
		);
	});
}
