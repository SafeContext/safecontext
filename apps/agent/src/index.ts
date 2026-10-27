import { createApp } from './app.ts';
import { createClassifier } from './classifier/classifier.ts';
import { createTier0, termListDetectors } from './classifier/tier0.ts';
import { tier1FromConfig } from './classifier/tier1/tier1.ts';
import { readConfig } from './config.ts';
import { jsonLogger } from './log.ts';
import { filePolicySource } from './policy-source.ts';
import { startServer } from './server.ts';

const config = readConfig();
const logger = jsonLogger();
const policy = filePolicySource(config.policyFile, logger);
// Tier 1 (#15) loads in the background; checks wait for it within their budget. Tier 2 (#16) goes here too.
const tier1 = tier1FromConfig(config.tier1, logger);
const classifier = createClassifier({
	tiers: [createTier0({ policyDetectors: termListDetectors }), ...(tier1 ? [tier1] : [])],
	budgetMs: config.checkBudgetMs
});

const server = await startServer(createApp({ policy, classifier, logger }), config.port);
logger.log('info', 'listening', { port: server.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		void Promise.all([server.close(), policy.close?.(), tier1?.close()]).finally(() => process.exit(0));
	});
}
