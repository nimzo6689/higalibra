import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from '@aws-sdk/client-dynamodb';
import type { ImageUrlCache } from '@higalibra/scraping';

const IMAGE_URL_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export class DynamoDbImageUrlCache implements ImageUrlCache {
  private readonly client: DynamoDBClient;
  private readonly tableName: string;
  private readonly now: () => number;

  constructor(
    client: DynamoDBClient,
    tableName: string,
    now: () => number = () => Date.now(),
  ) {
    this.client = client;
    this.tableName = tableName;
    this.now = now;
  }

  async get(title: string): Promise<string | null> {
    const response = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: { title: { S: title } },
        ConsistentRead: true,
      }),
    );
    const item = response.Item;
    if (!item) {
      return null;
    }

    const imageUrl = item.imageUrl?.S;
    const expiresAt = Number(item.expiresAt?.N);
    if (typeof imageUrl !== 'string' || !Number.isSafeInteger(expiresAt)) {
      throw new Error(
        `DynamoDB image URL cache contains an invalid entry for title ${JSON.stringify(title)}.`,
      );
    }
    return expiresAt > Math.floor(this.now() / 1000) ? imageUrl : null;
  }

  async set(title: string, imageUrl: string): Promise<void> {
    const expiresAt =
      Math.floor(this.now() / 1000) + IMAGE_URL_CACHE_TTL_SECONDS;
    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          title: { S: title },
          imageUrl: { S: imageUrl },
          expiresAt: { N: String(expiresAt) },
        },
      }),
    );
  }
}
