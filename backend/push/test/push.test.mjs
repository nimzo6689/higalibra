import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler } from '../dist/index.js';

const cognitoSub = 'family-member-sub';
const cardNo = '2010610570';
const validSubscription = {
  endpoint: 'https://push.example/subscription',
  keys: { p256dh: 'public-key', auth: 'auth-secret' },
};

function createRoute() {
  const saved = [];
  const deleted = [];
  const status = {
    lastUpdated: '2026-10-27T05:00:00.000Z',
    users: [],
  };
  const route = createHandler({
    async verifyToken(token) {
      if (token === 'valid-token') {
        return { sub: cognitoSub, cardNo };
      }
      if (token === 'other-user-token') {
        return { sub: 'not-allowed-member', cardNo: 'other-card' };
      }
      return null;
    },
    allowedUserIds: new Set([cognitoSub]),
    now: () => new Date('2026-10-27T05:00:00.000Z'),
    subscriptions: {
      async save(...args) {
        saved.push(args);
      },
      async delete(...args) {
        deleted.push(args);
      },
    },
    statusStore: {
      async load() {
        return status;
      },
    },
  });
  return { route, saved, deleted, status };
}

function event(
  method,
  body,
  headers = { 'x-cognito-id-token': 'valid-token' },
) {
  return {
    rawPath: '/subscriptions',
    requestContext: { http: { method } },
    headers,
    body: JSON.stringify(body),
  };
}

test('registers a subscription for the authenticated family member', async () => {
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

test('keys subscriptions by the signed card number claim, not the Cognito sub', async () => {
  const { route, saved } = createRoute();

  const response = await route(
    event('POST', { deviceId: 'phone-1', subscription: validSubscription }),
  );

  assert.equal(response.statusCode, 200);
  assert.equal(saved[0][0], cardNo);
  assert.notEqual(saved[0][0], cognitoSub);
});

test('deletes only the authenticated user device subscription', async () => {
  const { route, deleted } = createRoute();

  const response = await route(event('DELETE', { deviceId: 'phone-1' }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(deleted, [[cardNo, 'phone-1']]);
});

test('returns the status snapshot to an authenticated family member', async () => {
  const { route, status } = createRoute();
  const response = await route({
    rawPath: '/status',
    requestContext: { http: { method: 'GET' } },
    headers: { authorization: 'Bearer valid-token' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), status);
});

test('does not return status to an unauthenticated caller', async () => {
  const { route } = createRoute();
  const response = await route({
    rawPath: '/status',
    requestContext: { http: { method: 'GET' } },
  });

  assert.equal(response.statusCode, 401);
});

test('requires a valid ID token for family allow-listed user', async () => {
  const { route, saved } = createRoute();

  const missing = await route(
    event('POST', { deviceId: 'phone-1', subscription: validSubscription }, {}),
  );
  const invalid = await route(
    event(
      'POST',
      { deviceId: 'phone-1', subscription: validSubscription },
      {
        'x-cognito-id-token': 'invalid-token',
      },
    ),
  );
  const notAllowed = await route(
    event(
      'POST',
      { deviceId: 'phone-1', subscription: validSubscription },
      {
        'x-cognito-id-token': 'other-user-token',
      },
    ),
  );

  assert.equal(missing.statusCode, 401);
  assert.equal(invalid.statusCode, 401);
  assert.equal(notAllowed.statusCode, 401);
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
