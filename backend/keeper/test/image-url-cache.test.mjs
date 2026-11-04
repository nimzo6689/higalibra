import assert from 'node:assert/strict';
import test from 'node:test';
import { GetItemCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDbImageUrlCache } from '../src/image-url-cache.ts';

test('stores image URLs by title with a 30-day expiration', async () => {
  const commands = [];
  const now = Date.parse('2026-11-04T00:00:00.000Z');
  const cache = new DynamoDbImageUrlCache(
    {
      async send(command) {
        commands.push(command);
        return {};
      },
    },
    'image-url-cache',
    () => now,
  );

  await cache.set('Book title', 'https://covers.example/book.jpg');

  assert.ok(commands[0] instanceof PutItemCommand);
  assert.deepEqual(commands[0].input, {
    TableName: 'image-url-cache',
    Item: {
      title: { S: 'Book title' },
      imageUrl: { S: 'https://covers.example/book.jpg' },
      expiresAt: { N: String(Math.floor(now / 1000) + 30 * 24 * 60 * 60) },
    },
  });
});

test('returns only unexpired image URLs', async () => {
  const now = Date.parse('2026-11-04T00:00:00.000Z');
  let item = {
    title: { S: 'Book title' },
    imageUrl: { S: 'https://covers.example/book.jpg' },
    expiresAt: { N: String(Math.floor(now / 1000) + 1) },
  };
  const commands = [];
  const cache = new DynamoDbImageUrlCache(
    {
      async send(command) {
        commands.push(command);
        return { Item: item };
      },
    },
    'image-url-cache',
    () => now,
  );

  assert.equal(
    await cache.get('Book title'),
    'https://covers.example/book.jpg',
  );
  assert.ok(commands[0] instanceof GetItemCommand);
  assert.deepEqual(commands[0].input, {
    TableName: 'image-url-cache',
    Key: { title: { S: 'Book title' } },
    ConsistentRead: true,
  });

  item = { ...item, expiresAt: { N: String(Math.floor(now / 1000)) } };
  assert.equal(await cache.get('Book title'), null);
});
