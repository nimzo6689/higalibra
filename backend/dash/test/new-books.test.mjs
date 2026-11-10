import assert from 'node:assert/strict';
import test from 'node:test';
import {
  harvestNewBooks,
  MAX_NEW_BOOK_PAGES,
  NEW_BOOKS_PAGE_DELAY_MS,
} from '../dist/index.js';

function book(bookNo) {
  return {
    bookNo,
    title: `Title ${bookNo}`,
    author: 'Author',
    publisher: 'Publisher',
    acceptanceDate: null,
    publishedOn: null,
    availabilityStatus: '○ 在架あり',
  };
}

function makeStore(books = []) {
  const state = {
    snapshot: { version: 1, updatedAt: null, books },
    writes: [],
  };
  return {
    state,
    store: {
      async load() {
        return state.snapshot;
      },
      async save(snapshot) {
        state.snapshot = snapshot;
        state.writes.push(snapshot);
      },
    },
  };
}

test('harvests only books before the first registered book and merges the S3 list', async () => {
  const { store, state } = makeStore([book('registered')]);
  const pages = [];
  const calls = [];
  const delays = [];
  const result = await harvestNewBooks(
    {
      async setNewBooksSpan(span) {
        calls.push(`span:${span}`);
      },
      async getNewBooks(page) {
        pages.push(page);
        calls.push(`page:${page}`);
        return page === 1
          ? [book('new-3'), book('new-2')]
          : [book('new-1'), book('registered'), book('too-old')];
      },
    },
    store,
    {
      sleep: async (milliseconds) => delays.push(milliseconds),
      now: () => new Date('2026-11-06T12:00:00.000Z'),
    },
  );

  assert.deepEqual(calls, ['span:4', 'page:1', 'page:2']);
  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(delays, [NEW_BOOKS_PAGE_DELAY_MS]);
  assert.equal(result.updatedAt, '2026-11-06T12:00:00.000Z');
  assert.deepEqual(
    result.books.map(({ bookNo }) => bookNo),
    ['new-3', 'new-2', 'new-1', 'registered'],
  );
  assert.equal(state.writes.length, 1);
});

test('stops when the scraper returns the same final page twice', async () => {
  const { store } = makeStore();
  const pages = [];
  const result = await harvestNewBooks(
    {
      async setNewBooksSpan() {},
      async getNewBooks(page) {
        pages.push(page);
        return [book('last-page-book')];
      },
    },
    store,
    { sleep: async () => {} },
  );

  assert.deepEqual(pages, [1, 2]);
  assert.deepEqual(
    result.books.map(({ bookNo }) => bookNo),
    ['last-page-book'],
  );
});

test('does not request more than 100 pages', async () => {
  const { store } = makeStore();
  const pages = [];
  const delays = [];
  await harvestNewBooks(
    {
      async setNewBooksSpan() {},
      async getNewBooks(page) {
        pages.push(page);
        return [book(`book-${page}`)];
      },
    },
    store,
    { sleep: async (milliseconds) => delays.push(milliseconds) },
  );

  assert.equal(MAX_NEW_BOOK_PAGES, 100);
  assert.equal(pages.length, MAX_NEW_BOOK_PAGES);
  assert.equal(pages.at(-1), MAX_NEW_BOOK_PAGES);
  assert.equal(delays.length, MAX_NEW_BOOK_PAGES - 1);
  assert.ok(delays.every((delay) => delay >= 1000));
});
