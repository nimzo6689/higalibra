import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDashSecret } from '../src/aws.ts';
import { runDash } from '../src/dash.ts';

const secret = {
  baseUrl: 'https://library.example/OPW',
  reservationCardNo: 'card-2',
  users: [
    { name: 'Member 1', cardNo: 'card-1', password: 'pass-1' },
    { name: 'Member 2', cardNo: 'card-2', password: 'pass-2' },
    { name: 'Member 3', cardNo: 'card-3', password: 'pass-3' },
    { name: 'Member 4', cardNo: 'card-4', password: 'pass-4' },
  ],
  geminiApiKey: 'key',
  vapid: {
    subject: 'mailto:test@example.com',
    publicKey: 'public',
    privateKey: 'private',
  },
};

const books = [
  {
    bookNo: 'book-1',
    title: 'Recommended',
    author: 'Author',
    publisher: 'Publisher',
    publishedOn: '2026-10-01',
    availabilityStatus: '○ 在架あり',
    acceptanceDate: null,
  },
  {
    bookNo: 'book-2',
    title: 'Not recommended',
    author: 'Author',
    publisher: 'Publisher',
    publishedOn: '2026-10-01',
    availabilityStatus: '○ 在架あり',
    acceptanceDate: null,
  },
];

test('parses card-number keyed configuration without a duplicate userId', () => {
  const parsed = parseDashSecret(secret);

  assert.equal(parsed.reservationCardNo, 'card-2');
  assert.deepEqual(
    parsed.users.map(({ cardNo }) => cardNo),
    ['card-1', 'card-2', 'card-3', 'card-4'],
  );
  assert.equal('userId' in parsed.users[0], false);
});

function makeDependencies({ history = { version: 1, books: [] }, push } = {}) {
  const state = {
    history,
    saved: [],
    reservations: [],
    notifications: [],
    scraperOptions: [],
    evaluations: [],
  };
  return {
    state,
    dependencies: {
      historyStore: {
        async load() {
          return state.history;
        },
        async save(value) {
          state.history = value;
          state.saved.push(structuredClone(value));
        },
      },
      createScraper(options) {
        state.scraperOptions.push(options);
        return {
          async getNewBooks() {
            return books;
          },
          async reserveBook(bookNo) {
            state.reservations.push(bookNo);
            return new Response(null, { status: 302 });
          },
          async getUserStatus() {
            throw new Error('not used');
          },
          async extendLoan() {
            throw new Error('not used');
          },
        };
      },
      async evaluateBook(book) {
        state.evaluations.push(book.bookNo);
        return {
          shouldReserve: book.bookNo === 'book-1',
          reason: 'Credible reviews recommend this title.',
        };
      },
      pushSender: {
        async send(cardNo, notice) {
          state.notifications.push({ cardNo, notice });
          await push?.(cardNo, notice);
        },
      },
      now: () => new Date('2026-10-27T09:00:00.000Z'),
    },
  };
}

test('dry-run evaluates books and records decisions without reserving or notifying', async () => {
  const { dependencies, state } = makeDependencies();

  const result = await runDash(secret, dependencies, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.evaluatedCount, 2);
  assert.equal(result.reservedCount, 0);
  assert.deepEqual(state.reservations, []);
  assert.deepEqual(state.notifications, []);
  assert.equal(state.history.books[0].status, 'dry-run-selected');
  assert.equal(state.history.books[1].status, 'dry-run-not-selected');
});

test('re-evaluates dry-run history before making live reservations', async () => {
  const { dependencies, state } = makeDependencies();
  await runDash(secret, dependencies, { dryRun: true });

  const result = await runDash(secret, dependencies);

  assert.equal(result.evaluatedCount, 2);
  assert.deepEqual(state.reservations, ['book-1']);
  assert.equal(state.history.books[0].status, 'reserved');
});

test('reserves on the configured account and notifies the family', async () => {
  const { dependencies, state } = makeDependencies();

  const result = await runDash(secret, dependencies);

  assert.deepEqual(state.scraperOptions, [
    {
      baseUrl: secret.baseUrl,
      cardNo: 'card-2',
      password: 'pass-2',
    },
  ]);
  assert.deepEqual(state.reservations, ['book-1']);
  assert.equal(result.reservedCount, 1);
  assert.equal(result.notificationCount, 4);
  assert.deepEqual(
    state.notifications.map(({ cardNo }) => cardNo),
    secret.users.map(({ cardNo }) => cardNo),
  );
  assert.equal(state.history.books[0].status, 'reserved');
  assert.deepEqual(
    state.history.books[0].notificationSentTo,
    secret.users.map(({ cardNo }) => cardNo),
  );
});

test('skips previously reviewed books and retries unsent reservation notifications', async () => {
  const history = {
    version: 1,
    books: [
      {
        bookNo: 'book-1',
        title: 'Recommended',
        author: 'Author',
        publisher: 'Publisher',
        evaluatedAt: '2026-10-26T09:00:00.000Z',
        shouldReserve: true,
        reason: 'Good reviews.',
        status: 'reserved',
        reservationCardNo: 'card-2',
        notificationSentTo: [],
      },
      {
        bookNo: 'book-2',
        title: 'Not recommended',
        author: 'Author',
        publisher: 'Publisher',
        evaluatedAt: '2026-10-26T09:00:00.000Z',
        shouldReserve: false,
        reason: 'Insufficient evidence.',
        status: 'not-selected',
        reservationCardNo: 'card-2',
        notificationSentTo: [],
      },
    ],
  };
  const { dependencies, state } = makeDependencies({ history });

  const result = await runDash(secret, dependencies);

  assert.equal(result.skippedCount, 2);
  assert.equal(result.evaluatedCount, 0);
  assert.deepEqual(state.reservations, []);
  assert.equal(state.notifications.length, 4);
  assert.deepEqual(
    state.history.books[0].notificationSentTo,
    secret.users.map(({ cardNo }) => cardNo),
  );
});

test('does not repeat a reservation after a notification failure', async () => {
  const { dependencies, state } = makeDependencies({
    push: async () => {
      throw new Error('push failed');
    },
  });

  await assert.rejects(runDash(secret, dependencies), AggregateError);

  assert.deepEqual(state.reservations, ['book-1']);
  assert.equal(state.history.books[0].status, 'reserved');
  assert.deepEqual(state.history.books[0].notificationSentTo, []);
});

test('fails before scraping if the configured reservation account is missing', async () => {
  const { dependencies, state } = makeDependencies();

  await assert.rejects(
    runDash({ ...secret, reservationCardNo: 'unknown' }, dependencies),
    /is not configured/,
  );
  assert.deepEqual(state.scraperOptions, []);
});
