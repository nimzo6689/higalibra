import { createScraper } from '@higalibra/scraping';
import { DynamoDbPushSender } from '@higalibra/push';
import {
  createAwsClients,
  loadKeeperSecret,
  readKeeperConfiguration,
  S3StatusStore,
} from './aws.js';
import {
  createKeeperApiHandler,
  type KeeperApiEvent,
  type KeeperApiResponse,
} from './api.js';
import { runKeeper } from './keeper.js';
import type { KeeperResult } from './types.js';

export { runKeeper } from './keeper.js';
export { createKeeperApiHandler } from './api.js';
export type {
  KeeperDependencies,
  KeeperResult,
  KeeperSecret,
  KeeperUser,
  PushNotice,
  StatusStore,
  UserStatusSnapshot,
} from './types.js';

let configuredApiHandler:
  ((event: KeeperApiEvent) => Promise<KeeperApiResponse>) | undefined;

export async function handler(
  event: unknown,
): Promise<KeeperResult | KeeperApiResponse> {
  if (isKeeperApiEvent(event)) {
    configuredApiHandler ??= createKeeperApiHandler({
      runKeeper: runConfiguredKeeper,
    });
    return configuredApiHandler(event);
  }
  return runConfiguredKeeper();
}

async function runConfiguredKeeper(): Promise<KeeperResult> {
  const configuration = readKeeperConfiguration();
  const clients = createAwsClients(configuration.region);
  const secret = await loadKeeperSecret(
    clients.ssm,
    configuration.parameterName,
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

function isKeeperApiEvent(event: unknown): event is KeeperApiEvent {
  if (!isRecord(event) || !isRecord(event.requestContext)) return false;
  const requestContext = event.requestContext;
  return (
    isRecord(requestContext.http) &&
    typeof requestContext.http.method === 'string'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
