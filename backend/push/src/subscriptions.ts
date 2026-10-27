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
    cardNo: string,
    deviceId: string,
    subscription: PushSubscription,
    updatedAt: string,
  ): Promise<void> {
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: {
          id: subscriptionId(cardNo, deviceId),
          cardNo,
          deviceId,
          endpoint: subscription.endpoint,
          keys: subscription.keys,
          updatedAt,
        },
      }),
    );
  }

  async delete(cardNo: string, deviceId: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { id: subscriptionId(cardNo, deviceId) },
      }),
    );
  }
}

export function subscriptionId(cardNo: string, deviceId: string): string {
  return `USER#${cardNo}#DEVICE#${deviceId}`;
}
