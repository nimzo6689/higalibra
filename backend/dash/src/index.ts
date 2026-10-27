import { createScraper } from '@higalibra/scraping';
import { DynamoDbPushSender } from '@higalibra/push';
import {
  createAwsClients,
  loadDashSecret,
  readDashConfiguration,
} from './aws.js';
import { runDash } from './dash.js';
import { createGeminiBookEvaluator } from './gemini.js';
import { S3ResearchHistoryStore } from './history.js';

export { runDash, createBookPrompt } from './dash.js';
export { createGeminiBookEvaluator } from './gemini.js';
export {
  FileResearchHistoryStore,
  S3ResearchHistoryStore,
  parseResearchHistory,
} from './history.js';
export { parseDashSecret, readDashConfiguration } from './aws.js';
export type {
  BookDecision,
  DashBookResult,
  DashDependencies,
  DashResult,
  DashSecret,
  DashUser,
  ResearchHistory,
  ResearchHistoryStore,
  ResearchRecord,
  ResearchStatus,
  VapidCredentials,
} from './types.js';

export async function handler(): Promise<{
  reservationCardNo: string;
  newBookCount: number;
  evaluatedCount: number;
  skippedCount: number;
  reservedCount: number;
  notificationCount: number;
  dryRun: boolean;
}> {
  const configuration = readDashConfiguration();
  const clients = createAwsClients(configuration.region);
  const secret = await loadDashSecret(clients.ssm, configuration.parameterName);

  return runDash(
    secret,
    {
      historyStore: new S3ResearchHistoryStore(
        clients.s3,
        configuration.historyBucket,
        configuration.historyKey,
      ),
      createScraper,
      evaluateBook: createGeminiBookEvaluator(secret.geminiApiKey),
      pushSender: new DynamoDbPushSender(
        clients.dynamodb,
        configuration.subscriptionsTable,
        secret.vapid,
      ),
    },
    { dryRun: false },
  );
}
