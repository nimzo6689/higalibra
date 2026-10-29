import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { loadEmailCardNumbers, normalizeEmail } from './email-card-numbers.js';
import { DynamoDbSubscriptionStore } from './subscriptions.js';
import type {
  FunctionUrlEvent,
  FunctionUrlResponse,
  PushSubscription,
  SubscriptionStore,
} from './types.js';

export { DynamoDbPushSender } from './sender.js';
export { DynamoDbSubscriptionStore } from './subscriptions.js';
export { createPreSignUpHandler, preSignUpHandler } from './pre-signup.js';
export type {
  FunctionUrlEvent,
  FunctionUrlResponse,
  PushNotice,
  PushSender,
  PushSubscription,
  StoredPushSubscription,
  SubscriptionStore,
} from './types.js';

interface PushApiDependencies {
  subscriptions: SubscriptionStore;
  loadEmailCardNumbers: () => Promise<ReadonlyMap<string, string>>;
  now?: () => Date;
}

interface VerifiedUser {
  email: string;
}

interface PushApiConfiguration {
  allowedEmailsParameterName: string;
  tableName: string;
  region?: string;
}

let configuredHandler:
  ((event: FunctionUrlEvent) => Promise<FunctionUrlResponse>) | undefined;

export function createHandler(dependencies: PushApiDependencies) {
  return async function handle(
    event: FunctionUrlEvent,
  ): Promise<FunctionUrlResponse> {
    const method = (event.requestContext?.http?.method ?? '').toUpperCase();
    const path = event.rawPath ?? event.requestContext?.http?.path ?? '';
    if (path !== '/subscriptions') {
      return response(404, { error: 'Not found.' });
    }
    if (method !== 'POST' && method !== 'DELETE') {
      return response(
        405,
        { error: 'Method not allowed.' },
        { allow: 'POST, DELETE' },
      );
    }

    const user = readAuthenticatedUser(event.headers ?? {});
    if (!user) {
      return response(401, { error: 'Authenticated identity is missing.' });
    }

    let body: unknown;
    try {
      body = parseBody(event);
    } catch {
      return response(400, { error: 'Request body must be valid JSON.' });
    }
    if (!isRecord(body)) {
      return response(400, { error: 'Request body must be a JSON object.' });
    }

    const deviceId = readDeviceId(body.deviceId);
    if (!deviceId) {
      return response(400, {
        error: 'deviceId must be 1-128 URL-safe characters.',
      });
    }

    if (method === 'POST') {
      const subscription = readSubscription(body.subscription);
      if (!subscription) {
        return response(400, {
          error: 'subscription must contain an HTTPS endpoint and valid keys.',
        });
      }
      const cardNo = await resolveCardNo(dependencies, user.email);
      if (!cardNo) {
        return response(403, { error: 'Email address is not authorized.' });
      }
      const updatedAt = (
        dependencies.now ?? (() => new Date())
      )().toISOString();
      await dependencies.subscriptions.save(
        cardNo,
        deviceId,
        subscription,
        updatedAt,
      );
      return response(200, { deviceId, updatedAt });
    }

    const cardNo = await resolveCardNo(dependencies, user.email);
    if (!cardNo) {
      return response(403, { error: 'Email address is not authorized.' });
    }
    await dependencies.subscriptions.delete(cardNo, deviceId);
    return response(200, { deviceId, deleted: true });
  };
}

export async function handler(
  event: FunctionUrlEvent,
): Promise<FunctionUrlResponse> {
  configuredHandler ??= createConfiguredHandler(readConfiguration());
  return configuredHandler(event);
}

function createConfiguredHandler(configuration: PushApiConfiguration) {
  const client = new DynamoDBClient({ region: configuration.region });
  return createHandler({
    subscriptions: new DynamoDbSubscriptionStore(
      client,
      configuration.tableName,
    ),
    loadEmailCardNumbers: () =>
      loadEmailCardNumbers(configuration.allowedEmailsParameterName),
  });
}

function readConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): PushApiConfiguration {
  return {
    tableName: requiredEnvironmentValue(environment, 'SUBSCRIPTIONS_TABLE'),
    allowedEmailsParameterName: requiredEnvironmentValue(
      environment,
      'ALLOWED_EMAILS_PARAMETER_NAME',
    ),
    region: environment.AWS_REGION,
  };
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function readAuthenticatedUser(
  headers: Record<string, string | undefined>,
): VerifiedUser | null {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      value?.trim(),
    ]),
  );
  const email = normalizedHeaders.get('x-authenticated-email');
  return email ? { email } : null;
}

async function resolveCardNo(
  dependencies: PushApiDependencies,
  email: string,
): Promise<string | null> {
  return (
    (await dependencies.loadEmailCardNumbers()).get(normalizeEmail(email)) ??
    null
  );
}

function parseBody(event: FunctionUrlEvent): unknown {
  if (typeof event.body !== 'string') {
    throw new Error('Request body is missing.');
  }
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(text) as unknown;
}

function readDeviceId(value: unknown): string | null {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value)
    ? value
    : null;
}

function readSubscription(value: unknown): PushSubscription | null {
  if (!isRecord(value) || !isRecord(value.keys)) {
    return null;
  }
  const { endpoint, keys } = value;
  if (
    typeof endpoint !== 'string' ||
    typeof keys.p256dh !== 'string' ||
    keys.p256dh.length === 0 ||
    typeof keys.auth !== 'string' ||
    keys.auth.length === 0
  ) {
    return null;
  }
  try {
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password) {
      return null;
    }
  } catch {
    return null;
  }
  return {
    endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function response(
  statusCode: number,
  payload: Record<string, unknown>,
  additionalHeaders: Record<string, string> = {},
): FunctionUrlResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...additionalHeaders,
    },
    body: JSON.stringify(payload),
  };
}
