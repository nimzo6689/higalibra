import assert from 'node:assert/strict';
import test from 'node:test';
import { createReservationSettingsHandler } from '../dist/index.js';

const emptySettings = {
  expression: { children: [] },
};

function rule(id, field, values, join = 'and') {
  return {
    type: 'rule',
    id,
    field,
    join,
    negate: false,
    values,
  };
}

function makeHandler(books = [
  {
    bookNo: 'book-1',
    title: 'Matching Story',
    author: 'Writer',
    publisher: 'Publisher',
    acceptanceDate: null,
    publishedOn: null,
    availabilityStatus: '○ 在架あり',
  },
  {
    bookNo: 'book-2',
    title: 'Unmatched Story',
    author: 'Other',
    publisher: 'Other',
    acceptanceDate: null,
    publishedOn: null,
    availabilityStatus: '× 在架なし',
  },
]) {
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
    async loadNewBooks() {
      return {
        version: 1,
        updatedAt: '2026-11-06T12:00:00.000Z',
        books,
      };
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
    expression: {
      children: [rule('publisher-1', 'publishers', ['Publisher'])],
    },
  });

  const result = await handler(event('GET', { email: ' MEMBER@example.com ' }));

  assert.equal(result.statusCode, 200);
  assert.deepEqual(
    JSON.parse(result.body).settings.expression.children[0].values,
    ['Publisher'],
  );
});

test('saves validated settings for the authenticated card and ignores client card fields', async () => {
  const { handler, state } = makeHandler();
  const settings = {
    expression: {
      children: [
        rule('title-1', 'titleKeywords', ['Novel', 'Story']),
        rule('author-1', 'authors', ['Writer'], 'or'),
      ],
    },
  };

  const result = await handler(
    event('POST', {
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
        event('POST', {
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
        event('POST', {
          email: 'member@example.com',
          body: JSON.stringify({
            settings: {
              expression: {
                children: [
                  rule(
                    'author-1',
                    'authors',
                    Array.from({ length: 21 }, (_, index) => `Author ${index}`),
                  ),
                ],
              },
            },
          }),
        }),
      )
    ).statusCode,
    400,
  );
  assert.equal(
    (await handler(event('PUT', { email: 'member@example.com' }))).statusCode,
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

test('tests unsaved settings against harvested books without saving them', async () => {
  const { handler, state } = makeHandler();
  const settings = {
    expression: {
      children: [rule('author-1', 'authors', ['Writer'])],
    },
  };
  const result = await handler(
    event('POST', {
      path: '/reservation-settings/test',
      email: 'member@example.com',
      body: JSON.stringify({ cardNo: 'ignored-card', settings }),
    }),
  );

  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), {
    updatedAt: '2026-11-06T12:00:00.000Z',
    books: [
      {
        bookNo: 'book-1',
        title: 'Matching Story',
        author: 'Writer',
        publisher: 'Publisher',
        acceptanceDate: null,
        publishedOn: null,
        availabilityStatus: '○ 在架あり',
      },
    ],
  });
  assert.equal(state.writes.length, 0);
});

test('tests all stored books and returns at most the 50 newest matches', async () => {
  const books = Array.from({ length: 51 }, (_, index) => ({
    bookNo: `book-${index + 1}`,
    title: `Story ${index + 1}`,
    author: 'Other',
    publisher: 'Other',
    acceptanceDate: null,
    publishedOn: null,
    availabilityStatus: '○ 在架あり',
  })).concat(
    Array.from({ length: 60 }, (_, index) => ({
      bookNo: `match-${index + 1}`,
      title: `Matching Story ${index + 1}`,
      author: 'Writer',
      publisher: '光文社',
      acceptanceDate: null,
      publishedOn: null,
      availabilityStatus: '○ 在架あり',
    })),
  );
  const { handler } = makeHandler(books);
  const result = await handler(
    event('POST', {
      path: '/reservation-settings/test',
      email: 'member@example.com',
      body: JSON.stringify({
        settings: {
          expression: {
            children: [rule('publisher-1', 'publishers', ['光文社'])],
          },
        },
      }),
    }),
  );

  assert.equal(result.statusCode, 200);
  const returnedBooks = JSON.parse(result.body).books;
  assert.equal(returnedBooks.length, 50);
  assert.equal(returnedBooks[0].bookNo, 'match-1');
  assert.equal(returnedBooks.at(-1).bookNo, 'match-50');
});

test('limits the test route to authenticated POST requests', async () => {
  const { handler } = makeHandler();
  assert.equal(
    (
      await handler(
        event('GET', {
          path: '/reservation-settings/test',
          email: 'member@example.com',
        }),
      )
    ).statusCode,
    405,
  );
  assert.equal(
    (
      await handler(
        event('POST', {
          path: '/reservation-settings/test',
          body: JSON.stringify({ settings: emptySettings }),
        }),
      )
    ).statusCode,
    401,
  );
});
