import { createScraper } from '@higalibra/scraping';
import { DynamoDbPushSender } from '@higalibra/push';
import {
  createAwsClients,
  loadDashSecret,
  readDashConfiguration,
} from './aws.js';
import { runDash } from './dash.js';
import {
  S3ResearchHistoryStore,
  S3ReservationSettingsStore,
} from './history.js';

export { runDash } from './dash.js';
export {
  FileResearchHistoryStore,
  FileReservationSettingsStore,
  S3ResearchHistoryStore,
  S3ReservationSettingsStore,
  parseResearchHistory,
} from './history.js';
export {
  EMPTY_RESERVATION_SETTINGS,
  hasActiveReservationSettings,
  matchesReservationSettings,
  parseReservationSettings,
  reservationSettingsObjectKey,
} from './settings.js';
export {
  createReservationSettingsHandler,
  reservationSettingsApiHandler,
} from './reservation-settings-api.js';
export { parseDashSecret, readDashConfiguration } from './aws.js';
export type {
  DashBookResult,
  DashDependencies,
  DashResult,
  DashSecret,
  DashUser,
  ResearchHistory,
  ResearchHistoryStore,
  ResearchRecord,
  ResearchStatus,
  ReservationSettingsStore,
  VapidCredentials,
} from './types.js';
export type {
  MatchOperator,
  ReservationCriterion,
  ReservationSettings,
} from './settings.js';

export async function handler() {
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
      settingsStore: new S3ReservationSettingsStore(
        clients.s3,
        configuration.historyBucket,
        configuration.settingsPrefix,
      ),
      createScraper,
      pushSender: new DynamoDbPushSender(
        clients.dynamodb,
        configuration.subscriptionsTable,
        secret.vapid,
      ),
    },
    { dryRun: false },
  );
}
