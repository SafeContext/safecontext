import { createApp } from './app.ts';
import { createClassifier } from './classifier/classifier.ts';
import { createTier0 } from './classifier/tier0.ts';
import { readConfig } from './config.ts';
import { jsonLogger } from './log.ts';
import { filePolicySource } from './policy-source.ts';
import { startServer } from './server.ts';

const config = readConfig();
const logger = jsonLogger();
const policy = filePolicySource(config.policyFile, logger);
// Tiers 1 (#15) and 2 (#16) are added to this list.
const classifier = createClassifier({ tiers: [createTier0()], budgetMs: config.checkBudgetMs });

const server = await startServer(createApp({ policy, classifier, logger }), config.port);
logger.log('info', 'listening', { port: server.port });

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.once(signal, () => {
		void Promise.all([server.close(), policy.close?.()]).finally(() => process.exit(0));
	});
}
