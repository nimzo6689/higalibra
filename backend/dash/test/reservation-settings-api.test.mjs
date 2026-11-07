import assert from 'node:assert/strict';
import test from 'node:test';
import { createReservationSettingsHandler } from '../dist/index.js';

const emptySettings = {
  publishers: { operator: 'or', values: [] },
  authors: { operator: 'or', values: [] },
  titleKeywords: { operator: 'or', values: [] },
};

function makeHandler() {
  const state = { settings: new Map(), writes: [] };
  const handler = createReservationSettingsHandler({
    async loadEmailCardNumbers() {
      return new Map([['member@example.com', 'card-1']]);
    },
    async loadSettings(cardNo) {
      return state.settings.get(cardNo) ?? emptySettings;
    },
    async saveSettings(cardNo, settings) {
      state.settings.set(cardNo, settings);
      state.writes.push({ cardNo, settings });
    },
  });
  return { handler, state };
}

function event(method, { path = '/reservation-settings', email, body } = {}) {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    headers: email ? { 'x-authenticated-email': email } : {},
    body,
  };
}

test('requires a verified email forwarded by the authorizer', async () => {
  const { handler } = makeHandler();

  assert.equal((await handler(event('GET'))).statusCode, 401);
  assert.equal(
    (await handler(event('GET', { email: 'unknown@example.com' }))).statusCode,
    403,
  );
});

test('loads only the settings associated with the authenticated card', async () => {
  const { handler, state } = makeHandler();
  state.settings.set('card-1', {
    publishers: { operator: 'or', values: ['Publisher'] },
    authors: { operator: 'and', values: [] },
    titleKeywords: { operator: 'or', values: [] },
  });

  const result = await handler(event('GET', { email: ' MEMBER@example.com ' }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body).settings.publishers.values, [
    'Publisher',
  ]);
});

test('saves validated settings for the authenticated card and ignores client card fields', async () => {
  const { handler, state } = makeHandler();
  const settings = {
    ...emptySettings,
    titleKeywords: { operator: 'and', values: ['Novel', 'Story'] },
  };

  const result = await handler(
    event('PUT', {
      email: 'member@example.com',
      body: JSON.stringify({ cardNo: 'card-999', settings }),
    }),
  );

  assert.equal(result.statusCode, 200);
  assert.equal(state.writes[0].cardNo, 'card-1');
  assert.deepEqual(state.writes[0].settings, settings);
});

test('rejects invalid payloads, limits, and methods', async () => {
  const { handler } = makeHandler();

  assert.equal(
    (
      await handler(
        event('PUT', {
          email: 'member@example.com',
          body: '{',
        }),
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await handler(
        event('PUT', {
          email: 'member@example.com',
          body: JSON.stringify({
            settings: {
              ...emptySettings,
              authors: {
                operator: 'or',
                values: Array.from(
                  { length: 21 },
                  (_, index) => `Author ${index}`,
                ),
              },
            },
          }),
        }),
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await handler(event('POST', { email: 'member@example.com' }))).statusCode,
    405,
  );
  assert.equal(
    (
      await handler(
        event('GET', {
          path: '/reservation-settings/card-2',
          email: 'member@example.com',
        }),
      )
    ).statusCode,
    404,
  );
});
