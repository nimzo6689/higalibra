import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';
import { S3Client } from '@aws-sdk/client-s3';
import type { DashSecret } from './types.js';

export interface DashConfiguration {
  secretArn: string;
  historyBucket: string;
  historyKey: string;
  subscriptionsTable: string;
  region?: string;
}

export function readDashConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): DashConfiguration {
  return {
    secretArn: requiredEnvironmentValue(environment, 'DASH_SECRET_ARN'),
    historyBucket: requiredEnvironmentValue(environment, 'DASH_HISTORY_BUCKET'),
    historyKey:
      environment.DASH_HISTORY_KEY?.trim() || 'dash_research_history.json',
    subscriptionsTable: requiredEnvironmentValue(
      environment,
      'SUBSCRIPTIONS_TABLE',
    ),
    region: environment.AWS_REGION,
  };
}

export async function loadDashSecret(
  client: SecretsManagerClient,
  secretArn: string,
): Promise<DashSecret> {
  const response = await client.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  const secretText =
    response.SecretString ??
    (response.SecretBinary
      ? Buffer.from(response.SecretBinary).toString('utf8')
      : undefined);
  if (!secretText) {
    throw new Error(`Secrets Manager secret ${secretArn} has no value.`);
  }
  return parseDashSecret(JSON.parse(secretText) as unknown);
}

export function parseDashSecret(value: unknown): DashSecret {
  if (!isRecord(value)) {
    throw new Error('Dash secret must be a JSON object.');
  }
  if (!Array.isArray(value.users) || value.users.length !== 4) {
    throw new Error('Dash secret must include exactly four users.');
  }
  if (!isRecord(value.vapid)) {
    throw new Error('Dash secret must include VAPID credentials.');
  }

  const users = value.users.map((user, index) => {
    if (!isRecord(user)) {
      throw new Error(`Dash secret user at index ${index} must be an object.`);
    }
    return {
      userId: requiredString(user.userId, `users[${index}].userId`),
      name: requiredString(user.name, `users[${index}].name`),
      cardNo: requiredString(user.cardNo, `users[${index}].cardNo`),
      password: requiredString(user.password, `users[${index}].password`),
    };
  });
  if (new Set(users.map((user) => user.userId)).size !== users.length) {
    throw new Error('Dash secret contains duplicate userId values.');
  }

  const reservationUserId = requiredString(
    value.reservationUserId,
    'reservationUserId',
  );
  if (!users.some((user) => user.userId === reservationUserId)) {
    throw new Error(
      'Dash reservationUserId must match one of the configured users.',
    );
  }

  return {
    baseUrl: requiredString(value.baseUrl, 'baseUrl'),
    users,
    reservationUserId,
    geminiApiKey: requiredString(value.geminiApiKey, 'geminiApiKey'),
    vapid: {
      subject: requiredString(value.vapid.subject, 'vapid.subject'),
      publicKey: requiredString(value.vapid.publicKey, 'vapid.publicKey'),
      privateKey: requiredString(value.vapid.privateKey, 'vapid.privateKey'),
    },
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

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Dash secret field ${name} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function createAwsClients(region?: string): {
  dynamodb: DynamoDBClient;
  s3: S3Client;
  secrets: SecretsManagerClient;
} {
  return {
    dynamodb: new DynamoDBClient({ region }),
    s3: new S3Client({ region }),
    secrets: new SecretsManagerClient({ region }),
  };
}
