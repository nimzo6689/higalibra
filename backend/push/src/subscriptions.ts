import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { PushSubscription, SubscriptionStore } from './types.js';

export class DynamoDbSubscriptionStore implements SubscriptionStore {
  private readonly client: DynamoDBDocumentClient;

  constructor(
    dynamoClient: DynamoDBClient,
    private readonly tableName: string,
  ) {
    this.client = DynamoDBDocumentClient.from(dynamoClient);
  }

  async save(
    userId: string,
    deviceId: string,
    subscription: PushSubscription,
    updatedAt: string,
  ): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          id: subscriptionId(userId, deviceId),
          userId,
          deviceId,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          updatedAt,
        },
      }),
    );
  }

  async delete(userId: string, deviceId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { id: subscriptionId(userId, deviceId) },
      }),
    );
  }
}

export function subscriptionId(userId: string, deviceId: string): string {
  return `USER#${userId}#DEVICE#${deviceId}`;
}
