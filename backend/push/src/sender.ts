import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import webPush from 'web-push';
import type { PushNotice, PushSender, PushSubscription } from './types.js';

interface VapidCredentials {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export class DynamoDbPushSender implements PushSender {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    dynamoClient: DynamoDBClient,
    private readonly tableName: string,
    credentials: VapidCredentials,
  ) {
    this.client = DynamoDBDocumentClient.from(dynamoClient);
    webPush.setVapidDetails(
      credentials.subject,
      credentials.publicKey,
      credentials.privateKey,
    );
  }

  async send(userId: string, notice: PushNotice): Promise<void> {
    let lastKey: Record<string, unknown> | undefined;
    const subscriptions: PushSubscription[] = [];
    do {
      const response = await this.client.send(
        new ScanCommand({
          TableName: this.tableName,
          FilterExpression: '#userId = :userId',
          ExclusiveStartKey: lastKey,
          ProjectionExpression: 'endpoint, #keys',
          ExpressionAttributeNames: {
            '#userId': 'userId',
            '#keys': 'keys',
          },
          ExpressionAttributeValues: { ':userId': userId },
        }),
      );
      for (const item of response.Items ?? []) {
        subscriptions.push(parseSubscription(item, userId));
      }
      lastKey = response.LastEvaluatedKey;
    } while (lastKey);

    const payload = JSON.stringify({
      title: notice.title,
      body: notice.message,
      data: {
        type: notice.type,
        userId,
        bookTitle: notice.bookTitle,
        date: notice.date,
      },
    });
    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        webPush.sendNotification(subscription, payload),
      ),
    );
    const failures = results.flatMap((result) =>
      result.status === 'rejected' ? [result.reason] : [],
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures,
        `Could not send ${failures.length} push notification(s) to user ${userId}.`,
      );
    }
  }
}

function parseSubscription(
  value: Record<string, unknown>,
  userId: string,
): PushSubscription {
  const keys = value.keys;
  if (
    typeof value.endpoint !== 'string' ||
    !isRecord(keys) ||
    typeof keys.p256dh !== 'string' ||
    typeof keys.auth !== 'string'
  ) {
    throw new Error(
      `DynamoDB contains an invalid push subscription for user ${userId}.`,
    );
  }

  return {
    endpoint: value.endpoint,
    keys: { p256dh: keys.p256dh, auth: keys.auth },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
