import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler } from '../dist/index.js';

const email = 'Member@Example.com';
const cardNo = '2010610570';
const validSubscription = {
  endpoint: 'https://push.example/subscription',
  keys: { p256dh: 'public-key', auth: 'auth-secret' },
};

function createRoute() {
  const saved = [];
  const deleted = [];
  const route = createHandler({
    now: () => new Date('2026-10-27T05:00:00.000Z'),
    loadEmailCardNumbers: async () => new Map([['member@example.com', cardNo]]),
    subscriptions: {
      async save(...args) {
        saved.push(args);
      },
      async delete(...args) {
        deleted.push(args);
      },
    },
  });
  return { route, saved, deleted };
}

function event(
  method,
  body,
  headers = {
    'x-authenticated-email': email,
  },
) {
  return {
    rawPath: '/subscriptions',
    requestContext: { http: { method } },
    headers,
    body: JSON.stringify(body),
  };
}

test('registers a subscription for the edge-authenticated family member', async () => {
  const { route, saved } = createRoute();

  const response = await route(
    event('POST', {
      deviceId: 'phone-1',
      cardNo: 'attacker-selected-card',
      subscription: validSubscription,
    }),
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(saved, [
    [cardNo, 'phone-1', validSubscription, '2026-10-27T05:00:00.000Z'],
  ]);
});

test('resolves the card number from the normalized verified email', async () => {
  const { route, saved } = createRoute();

  const response = await route(
    event('POST', { deviceId: 'phone-1', subscription: validSubscription }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(saved[0][0], cardNo);
});

test('deletes only the edge-authenticated user device subscription', async () => {
  const { route, deleted } = createRoute();

  const response = await route(event('DELETE', { deviceId: 'phone-1' }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(deleted, [[cardNo, 'phone-1']]);
});

test('requires a verified identity from the CloudFront edge authorizer', async () => {
  const { route, saved } = createRoute();

  const missing = await route(
    event('POST', { deviceId: 'phone-1', subscription: validSubscription }, {}),
  );
  const incompleteIdentity = await route(
    event(
      'POST',
      { deviceId: 'phone-1', subscription: validSubscription },
      { 'x-authenticated-sub': 'unexpected-sub-header' },
    ),
  );

  assert.equal(missing.statusCode, 401);
  assert.equal(incompleteIdentity.statusCode, 401);
  assert.equal(saved.length, 0);
});

test('rejects authenticated emails without a card number mapping', async () => {
  const { route, saved } = createRoute();
  const response = await route(
    event(
      'POST',
      {
        deviceId: 'phone-1',
        subscription: validSubscription,
      },
      { 'x-authenticated-email': 'unknown@example.com' },
    ),
  );

  assert.equal(response.statusCode, 403);
  assert.equal(saved.length, 0);
});

test('rejects malformed or insecure subscriptions and invalid device IDs', async () => {
  const { route, saved } = createRoute();

  const insecure = await route(
    event('POST', {
      deviceId: 'phone-1',
      subscription: {
        ...validSubscription,
        endpoint: 'http://push.example/subscription',
      },
    }),
  );
  const invalidDeviceId = await route(
    event('POST', {
      deviceId: 'device#1',
      subscription: validSubscription,
    }),
  );

  assert.equal(insecure.statusCode, 400);
  assert.equal(invalidDeviceId.statusCode, 400);
  assert.equal(saved.length, 0);
});

test('rejects unsupported routes and methods', async () => {
  const { route } = createRoute();

  assert.equal((await route({ rawPath: '/other' })).statusCode, 404);
  assert.equal(
    (
      await route({
        rawPath: '/subscriptions',
        requestContext: { http: { method: 'GET' } },
      })
    ).statusCode,
    405,
  );
});
