import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchesReservationSettings,
  parseDashSecret,
  parseResearchHistory,
  runDash,
} from '../dist/index.js';

const secret = {
  baseUrl: 'https://library.example/OPW',
  users: [
    { name: 'Member 1', cardNo: 'card-1', password: 'pass-1' },
    { name: 'Member 2', cardNo: 'card-2', password: 'pass-2' },
    { name: 'Member 3', cardNo: 'card-3', password: 'pass-3' },
    { name: 'Member 4', cardNo: 'card-4', password: 'pass-4' },
  ],
  vapid: {
    subject: 'mailto:test@example.com',
    publicKey: 'public',
    privateKey: 'private',
  },
};

const books = [
  {
    bookNo: 'book-1',
    title: 'Recommended Novel',
    author: 'Author',
    publisher: 'Publisher',
    publishedOn: null,
    availabilityStatus: '○ 在架あり',
    acceptanceDate: null,
  },
  {
    bookNo: 'book-2',
    title: 'Other New Title',
    author: 'Writer',
    publisher: 'Other',
    publishedOn: null,
    availabilityStatus: '○ 在架あり',
    acceptanceDate: null,
  },
];

const settings = {
  'card-1': {
    publishers: { operator: 'or', values: ['Publisher', 'Other'] },
    authors: { operator: 'or', values: [] },
    titleKeywords: { operator: 'or', values: [] },
  },
  'card-2': {
    publishers: { operator: 'or', values: [] },
    authors: { operator: 'and', values: ['Writer'] },
    titleKeywords: { operator: 'or', values: [] },
  },
  'card-3': {
    publishers: { operator: 'or', values: [] },
    authors: { operator: 'or', values: [] },
    titleKeywords: { operator: 'or', values: [] },
  },
  'card-4': {
    publishers: { operator: 'or', values: [] },
    authors: { operator: 'or', values: [] },
    titleKeywords: { operator: 'or', values: ['mMeNdEd'] },
  },
};

function makeDependencies({ history = { version: 2, books: [] }, push } = {}) {
  const state = {
    history,
    saved: [],
    reservations: [],
    notifications: [],
    scraperOptions: [],
    settingsLoads: [],
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
      settingsStore: {
        async load(cardNo) {
          state.settingsLoads.push(cardNo);
          return settings[cardNo];
        },
      },
      createScraper(options) {
        state.scraperOptions.push(options);
        return {
          async getNewBooks() {
            return books;
          },
          async reserveBook(bookNo) {
            state.reservations.push({
              cardNo: options.cardNo,
              bookNo,
            });
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

test('parses four user accounts without Gemini or a fixed reservation account', () => {
  const parsed = parseDashSecret(secret);

  assert.deepEqual(
    parsed.users.map(({ cardNo }) => cardNo),
    ['card-1', 'card-2', 'card-3', 'card-4'],
  );
  assert.equal('geminiApiKey' in parsed, false);
  assert.equal('reservationCardNo' in parsed, false);
});

test('matches each populated field with its operator and title substrings', () => {
  const book = {
    ...books[0],
    title: 'A RECOMMENDED story',
    publisher: 'Publisher',
    author: 'Author',
  };
  assert.equal(
    matchesReservationSettings(book, {
      publishers: { operator: 'or', values: ['Elsewhere', 'Publisher'] },
      authors: { operator: 'and', values: ['Author', 'author'] },
      titleKeywords: { operator: 'and', values: ['recommended', 'STORY'] },
    }),
    true,
  );
  assert.equal(
    matchesReservationSettings(book, {
      publishers: { operator: 'and', values: ['Publisher', 'Elsewhere'] },
      authors: { operator: 'or', values: [] },
      titleKeywords: { operator: 'or', values: [] },
    }),
    false,
  );
  assert.equal(
    matchesReservationSettings(book, {
      publishers: { operator: 'or', values: [] },
      authors: { operator: 'or', values: [] },
      titleKeywords: { operator: 'or', values: [] },
    }),
    false,
  );
});

test('fetches new books with the first active user and reserves for each matching card', async () => {
  const { dependencies, state } = makeDependencies();

  const result = await runDash(secret, dependencies);

  assert.equal(result.fetchedByCardNo, 'card-1');
  assert.equal(result.newBookCount, 2);
  assert.equal(result.matchedCount, 4);
  assert.equal(result.reservedCount, 4);
  assert.deepEqual(state.scraperOptions, [
    { baseUrl: secret.baseUrl, cardNo: 'card-1', password: 'pass-1' },
    { baseUrl: secret.baseUrl, cardNo: 'card-4', password: 'pass-4' },
    { baseUrl: secret.baseUrl, cardNo: 'card-2', password: 'pass-2' },
  ]);
  assert.deepEqual(state.reservations, [
    { cardNo: 'card-1', bookNo: 'book-1' },
    { cardNo: 'card-4', bookNo: 'book-1' },
    { cardNo: 'card-1', bookNo: 'book-2' },
    { cardNo: 'card-2', bookNo: 'book-2' },
  ]);
  assert.deepEqual(
    state.notifications.map(({ cardNo }) => cardNo),
    ['card-1', 'card-4', 'card-1', 'card-2'],
  );
  assert.equal(state.history.version, 2);
  assert.equal(state.history.books.length, 4);
});

test('returns without scraping when no user has an active criterion', async () => {
  const { dependencies, state } = makeDependencies();
  dependencies.settingsStore.load = async () => settings['card-3'];

  const result = await runDash(secret, dependencies);

  assert.equal(result.fetchedByCardNo, null);
  assert.equal(result.newBookCount, 0);
  assert.deepEqual(state.scraperOptions, []);
});

test('dry-run reports matching books without recording or reserving them', async () => {
  const { dependencies, state } = makeDependencies();

  const result = await runDash(secret, dependencies, { dryRun: true });

  assert.equal(result.dryRun, true);
  assert.equal(result.matchedCount, 4);
  assert.equal(result.reservedCount, 0);
  assert.deepEqual(state.reservations, []);
  assert.deepEqual(state.notifications, []);
  assert.deepEqual(state.saved, []);
  assert.equal(
    result.books.filter((book) => book.status === 'dry-run-selected').length,
    4,
  );
});

test('skips already handled books per card and retries notification only to the reserving user', async () => {
  const history = {
    version: 2,
    books: [
      {
        reservationCardNo: 'card-2',
        bookNo: 'book-2',
        title: 'Other New Title',
        author: 'Writer',
        publisher: 'Other',
        updatedAt: '2026-10-26T09:00:00.000Z',
        status: 'reserved',
        notificationSentTo: [],
      },
    ],
  };
  const { dependencies, state } = makeDependencies({ history });

  const result = await runDash(secret, dependencies);

  assert.equal(result.skippedCount, 1);
  assert.equal(
    state.reservations.some(
      ({ cardNo, bookNo }) => cardNo === 'card-2' && bookNo === 'book-2',
    ),
    false,
  );
  assert.deepEqual(
    state.notifications.map(({ cardNo }) => cardNo),
    ['card-2', 'card-1', 'card-4', 'card-1'],
  );
  const migrated = state.history.books.find(
    ({ reservationCardNo, bookNo }) =>
      reservationCardNo === 'card-2' && bookNo === 'book-2',
  );
  assert.deepEqual(migrated.notificationSentTo, ['card-2']);
});

test('keeps a successful reservation when its notification fails', async () => {
  const { dependencies, state } = makeDependencies({
    push: async () => {
      throw new Error('push failed');
    },
  });

  await assert.rejects(runDash(secret, dependencies), AggregateError);

  assert.equal(state.reservations.length, 4);
  assert.ok(state.history.books.every(({ status }) => status === 'reserved'));
  assert.ok(
    state.history.books.every(({ notificationSentTo }) =>
      notificationSentTo.every(
        (cardNo) =>
          cardNo === 'card-1' || cardNo === 'card-2' || cardNo === 'card-4',
      ),
    ),
  );
});

test('migrates only pending and completed records from the previous history format', () => {
  const history = parseResearchHistory({
    version: 1,
    books: [
      {
        bookNo: 'reserved',
        title: 'Reserved',
        author: 'Author',
        publisher: 'Publisher',
        evaluatedAt: '2026-10-26T09:00:00.000Z',
        shouldReserve: true,
        reason: 'Previously selected.',
        status: 'reserved',
        reservationUserId: 'card-2',
        notificationSentTo: ['card-1', 'card-2'],
      },
      {
        bookNo: 'not-selected',
        title: 'Not selected',
        author: 'Author',
        publisher: 'Publisher',
        evaluatedAt: '2026-10-26T09:00:00.000Z',
        shouldReserve: false,
        reason: 'Not selected.',
        status: 'not-selected',
        reservationCardNo: 'card-2',
        notificationSentTo: [],
      },
    ],
  });

  assert.equal(history.version, 2);
  assert.equal(history.books.length, 1);
  assert.equal(history.books[0].reservationCardNo, 'card-2');
  assert.deepEqual(history.books[0].notificationSentTo, ['card-1', 'card-2']);
});
