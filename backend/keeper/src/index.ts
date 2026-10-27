import { createScraper } from '@higalibra/scraping';
import { DynamoDbPushSender } from '@higalibra/push';
import {
  createAwsClients,
  loadKeeperSecret,
  readKeeperConfiguration,
  S3StatusStore,
} from './aws.js';
import { runKeeper } from './keeper.js';

export { runKeeper } from './keeper.js';
export type {
  KeeperDependencies,
  KeeperResult,
  KeeperSecret,
  KeeperUser,
  PushNotice,
  StatusStore,
  UserStatusSnapshot,
} from './types.js';

export async function handler(): Promise<{
  userCount: number;
  extendedBookCount: number;
  notificationCount: number;
  lastUpdated: string;
}> {
  const configuration = readKeeperConfiguration();
  const clients = createAwsClients(configuration.region);
  const secret = await loadKeeperSecret(
    clients.secrets,
    configuration.secretArn,
  );

  return runKeeper(secret, {
    statusStore: new S3StatusStore(
      clients.s3,
      configuration.statusBucket,
      configuration.statusKey,
    ),
    pushSender: new DynamoDbPushSender(
      clients.dynamodb,
      configuration.subscriptionsTable,
      secret.vapid,
    ),
    createScraper,
  });
}
