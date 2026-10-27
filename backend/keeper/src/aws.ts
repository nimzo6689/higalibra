import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import type { KeeperSecret, StatusStore, UserStatusSnapshot } from './types.js';

export interface KeeperConfiguration {
  parameterName: string;
  statusBucket: string;
  statusKey: string;
  subscriptionsTable: string;
  region?: string;
}

export function readKeeperConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): KeeperConfiguration {
  return {
    parameterName: requiredEnvironmentValue(
      environment,
      'KEEPER_PARAMETER_NAME',
    ),
    statusBucket: requiredEnvironmentValue(environment, 'STATUS_BUCKET'),
    statusKey: environment.STATUS_KEY?.trim() || 'user_status.json',
    subscriptionsTable: requiredEnvironmentValue(
      environment,
      'SUBSCRIPTIONS_TABLE',
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

export async function loadKeeperSecret(
  client: SSMClient,
  parameterName: string,
): Promise<KeeperSecret> {
  const response = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );
  const secretText = response.Parameter?.Value;
  if (!secretText) {
    throw new Error(`SSM parameter ${parameterName} has no value.`);
  }

  return parseKeeperSecret(JSON.parse(secretText) as unknown);
}

function parseKeeperSecret(value: unknown): KeeperSecret {
  if (!isRecord(value)) {
    throw new Error('Keeper secret must be a JSON object.');
  }
  const baseUrl = requiredString(value.baseUrl, 'baseUrl');
  const usersValue = value.users;
  const vapidValue = value.vapid;
  if (!Array.isArray(usersValue) || usersValue.length !== 4) {
    throw new Error('Keeper secret must include exactly four users.');
  }
  if (!isRecord(vapidValue)) {
    throw new Error('Keeper secret must include VAPID credentials.');
  }

  const users = usersValue.map((user, index) => {
    if (!isRecord(user)) {
      throw new Error(
        `Keeper secret user at index ${index} must be an object.`,
      );
    }
    return {
      name: requiredString(user.name, `users[${index}].name`),
      cardNo: requiredString(user.cardNo, `users[${index}].cardNo`),
      password: requiredString(user.password, `users[${index}].password`),
    };
  });
  const cardNumbers = users.map((user) => user.cardNo);
  if (new Set(cardNumbers).size !== cardNumbers.length) {
    throw new Error('Keeper secret contains duplicate cardNo values.');
  }

  return {
    baseUrl,
    users,
    vapid: {
      subject: requiredString(vapidValue.subject, 'vapid.subject'),
      publicKey: requiredString(vapidValue.publicKey, 'vapid.publicKey'),
      privateKey: requiredString(vapidValue.privateKey, 'vapid.privateKey'),
    },
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Keeper secret field ${name} must be a non-empty string.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export class S3StatusStore implements StatusStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  async load(): Promise<UserStatusSnapshot | null> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key }),
      );
      if (!response.Body) {
        throw new Error(
          `Status object s3://${this.bucket}/${this.key} has no body.`,
        );
      }
      const parsed: unknown = JSON.parse(
        await response.Body.transformToString(),
      );
      return parseSnapshot(parsed);
    } catch (error) {
      if (isS3NotFound(error)) {
        return null;
      }
      throw error;
    }
  }

  async save(snapshot: UserStatusSnapshot): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Body: JSON.stringify(snapshot),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
  }
}

function parseSnapshot(value: unknown): UserStatusSnapshot {
  if (
    !isRecord(value) ||
    typeof value.lastUpdated !== 'string' ||
    !Array.isArray(value.users)
  ) {
    throw new Error('Stored user status has an invalid JSON shape.');
  }

  const users = value.users.map((user) => {
    if (
      !isRecord(user) ||
      typeof user.name !== 'string' ||
      !Array.isArray(user.borrowedBooks) ||
      !Array.isArray(user.reservedBooks)
    ) {
      throw new Error('Stored user status contains an invalid user entry.');
    }
    const cardNo =
      typeof user.cardNo === 'string'
        ? user.cardNo
        : typeof user.userId === 'string'
          ? user.userId
          : null;
    if (!cardNo) {
      throw new Error('Stored user status contains an invalid user entry.');
    }
    const borrowedBooks = user.borrowedBooks.map((book) => {
      if (
        !isRecord(book) ||
        typeof book.barcode !== 'string' ||
        typeof book.status !== 'string' ||
        typeof book.title !== 'string' ||
        typeof book.author !== 'string' ||
        typeof book.genre !== 'string' ||
        typeof book.loanDate !== 'string' ||
        typeof book.returnDate !== 'string'
      ) {
        throw new Error('Stored user status contains an invalid loan.');
      }
      return {
        barcode: book.barcode,
        status: book.status,
        title: book.title,
        author: book.author,
        genre: book.genre,
        loanDate: book.loanDate,
        returnDate: book.returnDate,
      };
    });
    const reservedBooks = user.reservedBooks.map((book) => {
      if (
        !isRecord(book) ||
        typeof book.rank !== 'string' ||
        typeof book.title !== 'string' ||
        typeof book.reservedOn !== 'string' ||
        (book.holdExpiresOn !== null && typeof book.holdExpiresOn !== 'string')
      ) {
        throw new Error('Stored user status contains an invalid reservation.');
      }
      return {
        rank: book.rank,
        title: book.title,
        reservedOn: book.reservedOn,
        holdExpiresOn: book.holdExpiresOn,
      };
    });
    return {
      cardNo,
      name: user.name,
      borrowedBooks,
      reservedBooks,
    };
  });

  return { lastUpdated: value.lastUpdated, users };
}

function isS3NotFound(error: unknown): boolean {
  return (
    isRecord(error) && (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}

export function createAwsClients(region?: string): {
  s3: S3Client;
  ssm: SSMClient;
  dynamodb: DynamoDBClient;
} {
  return {
    s3: new S3Client({ region }),
    ssm: new SSMClient({ region }),
    dynamodb: new DynamoDBClient({ region }),
  };
}
