import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import {
  FailedAssertionError,
  JwtInvalidSignatureError,
  JwtParseError,
  JwtWithoutValidKidError,
  KidNotFoundInJwksError,
} from 'aws-jwt-verify/error';
import { DynamoDbSubscriptionStore } from './subscriptions.js';
import type {
  FunctionUrlEvent,
  FunctionUrlResponse,
  PushSubscription,
  SubscriptionStore,
} from './types.js';

export { DynamoDbPushSender } from './sender.js';
export { DynamoDbSubscriptionStore } from './subscriptions.js';
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
  verifyToken(token: string): Promise<VerifiedUser | null>;
  subscriptions: SubscriptionStore;
  statusStore: StatusStore;
  allowedUserIds: ReadonlySet<string>;
  now?: () => Date;
}

interface VerifiedUser {
  sub: string;
  cardNo: string;
}

interface PushApiConfiguration {
  tableName: string;
  statusBucket: string;
  statusKey: string;
  userPoolId: string;
  clientId: string;
  allowedUserIds: ReadonlySet<string>;
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
    if (path !== '/subscriptions' && path !== '/status') {
      return response(404, { error: 'Not found.' });
    }
    if (
      (path === '/subscriptions' && method !== 'POST' && method !== 'DELETE') ||
      (path === '/status' && method !== 'GET')
    ) {
      return response(
        405,
        { error: 'Method not allowed.' },
        { allow: path === '/status' ? 'GET' : 'POST, DELETE' },
      );
    }

    const token = readIdToken(event.headers ?? {});
    if (!token) {
      return response(401, { error: 'Authentication is required.' });
    }

    const user = await dependencies.verifyToken(token);
    if (!user || !dependencies.allowedUserIds.has(user.sub)) {
      return response(401, { error: 'The ID token is not authorized.' });
    }

    if (path === '/status') {
      const status = await dependencies.statusStore.load();
      return status
        ? response(200, status)
        : response(404, { error: 'User status is not available yet.' });
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
      const updatedAt = (
        dependencies.now ?? (() => new Date())
      )().toISOString();
      await dependencies.subscriptions.save(
        user.cardNo,
        deviceId,
        subscription,
        updatedAt,
      );
      return response(200, { deviceId, updatedAt });
    }

    await dependencies.subscriptions.delete(user.cardNo, deviceId);
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
  const verifier = CognitoJwtVerifier.create({
    userPoolId: configuration.userPoolId,
    tokenUse: 'id',
    clientId: configuration.clientId,
  });
  const client = new DynamoDBClient({ region: configuration.region });
  const s3 = new S3Client({ region: configuration.region });
  return createHandler({
    async verifyToken(token) {
      try {
        const claims = await verifier.verify(token);
        const cardNo = claims['custom:cardNo'];
        return typeof claims.sub === 'string' &&
          typeof cardNo === 'string' &&
          cardNo.trim() !== ''
          ? { sub: claims.sub, cardNo }
          : null;
      } catch (error) {
        if (isInvalidIdToken(error)) {
          return null;
        }
        throw error;
      }
    },
    subscriptions: new DynamoDbSubscriptionStore(
      client,
      configuration.tableName,
    ),
    statusStore: new S3UserStatusStore(
      s3,
      configuration.statusBucket,
      configuration.statusKey,
    ),
    allowedUserIds: configuration.allowedUserIds,
  });
}

interface StatusStore {
  load(): Promise<Record<string, unknown> | null>;
}

class S3UserStatusStore implements StatusStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  async load(): Promise<Record<string, unknown> | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key }),
      );
      if (!result.Body) {
        throw new Error('The user status object has no body.');
      }
      const value: unknown = JSON.parse(await result.Body.transformToString());
      if (
        !isRecord(value) ||
        typeof value.lastUpdated !== 'string' ||
        !Array.isArray(value.users)
      ) {
        throw new Error('The user status object has an invalid JSON shape.');
      }
      return value;
    } catch (error) {
      if (isRecord(error) && error.name === 'NoSuchKey') {
        return null;
      }
      throw error;
    }
  }
}

function isInvalidIdToken(error: unknown): boolean {
  return (
    error instanceof FailedAssertionError ||
    error instanceof JwtInvalidSignatureError ||
    error instanceof JwtParseError ||
    error instanceof JwtWithoutValidKidError ||
    error instanceof KidNotFoundInJwksError
  );
}

function readConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): PushApiConfiguration {
  return {
    tableName: requiredEnvironmentValue(environment, 'SUBSCRIPTIONS_TABLE'),
    statusBucket: requiredEnvironmentValue(environment, 'STATUS_BUCKET'),
    statusKey: environment.STATUS_KEY?.trim() || 'user_status.json',
    userPoolId: requiredEnvironmentValue(environment, 'COGNITO_USER_POOL_ID'),
    clientId: requiredEnvironmentValue(environment, 'COGNITO_CLIENT_ID'),
    allowedUserIds: parseAllowedUserIds(
      requiredEnvironmentValue(environment, 'ALLOWED_USER_IDS'),
    ),
    region: environment.AWS_REGION,
  };
}

function parseAllowedUserIds(value: string): ReadonlySet<string> {
  const userIds = new Set(
    value
      .split(',')
      .map((userId) => userId.trim())
      .filter(Boolean),
  );
  if (userIds.size === 0) {
    throw new Error('ALLOWED_USER_IDS must contain at least one user ID.');
  }
  return userIds;
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

function readIdToken(
  headers: Record<string, string | undefined>,
): string | null {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      value?.trim(),
    ]),
  );
  const token =
    normalizedHeaders.get('x-cognito-id-token') ??
    normalizedHeaders.get('authorization')?.replace(/^Bearer\s+/i, '');
  return token || null;
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
