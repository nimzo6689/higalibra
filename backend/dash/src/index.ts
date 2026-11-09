import { createScraper } from '@higalibra/scraping';
import { DynamoDbPushSender } from '@higalibra/push';
import {
  createAwsClients,
  loadDashSecret,
  readDashConfiguration,
  readNewBooksHarvestConfiguration,
} from './aws.js';
import { runDash } from './dash.js';
import { harvestNewBooks, S3NewBooksStore } from './new-books.js';
import {
  S3ResearchHistoryStore,
  S3ReservationSettingsStore,
} from './history.js';

export { runDash } from './dash.js';
export {
  harvestNewBooks,
  MAX_NEW_BOOK_PAGES,
  NEW_BOOKS_PAGE_DELAY_MS,
  parseNewBooksSnapshot,
  S3NewBooksStore,
} from './new-books.js';
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
export {
  parseDashSecret,
  readDashConfiguration,
  readNewBooksHarvestConfiguration,
} from './aws.js';
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
  ReservationExpression,
  ReservationExpressionNode,
  ReservationField,
  ReservationGroupNode,
  ReservationRule,
  ReservationSettings,
} from './settings.js';
export type {
  NewBooksSnapshot,
  NewBooksStore,
  StoredNewBook,
} from './new-books.js';

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

export async function harvestNewBooksHandler() {
  const configuration = readNewBooksHarvestConfiguration();
  const clients = createAwsClients(configuration.region);
  const secret = await loadDashSecret(clients.ssm, configuration.parameterName);
  const firstUser = secret.users[0];
  if (!firstUser) {
    throw new Error('Dash secret must include at least one configured user.');
  }

  return harvestNewBooks(
    createScraper({
      baseUrl: secret.baseUrl,
      cardNo: firstUser.cardNo,
      password: firstUser.password,
    }),
    new S3NewBooksStore(
      clients.s3,
      configuration.historyBucket,
      configuration.newBooksKey,
    ),
  );
}
