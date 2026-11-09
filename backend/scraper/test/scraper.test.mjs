import assert from 'node:assert/strict';
import test from 'node:test';
import { createScraper } from '../dist/index.js';

test('getUserStatus caches cover image URLs by book title', async () => {
  const requests = [];
  const cache = new Map();
  const cacheGets = [];
  const cacheSets = [];
  const originalFetch = globalThis.fetch;
  const statusHtml = `
    <meta charset="utf-8">
    <div id="ContentLend"><table class="el-table-bordered">
      <tr><th>status</th></tr>
      <tr>
        <td></td><td>更新できません</td><td><a href="books/borrowed">借りた本</a></td>
        <td>一般</td><td>barcode-1</td><td></td><td>2026/10/01</td><td>2026/10/31</td>
      </tr>
      <tr><td></td><td>まだ更新できません</td></tr>
      <tr>
        <td></td><td>再貸出</td><td>再貸出の本</td>
        <td>一般</td><td>barcode-2</td><td></td><td>2026/10/02</td><td>2026/11/01</td>
      </tr>
      <tr><td></td><td></td></tr>
    </table></div>
    <div id="ContentRsv"><table class="el-table-bordered">
      <tr><th>rank</th></tr>
      <tr>
        <td></td><td></td><td>1 / 2</td><td><a href="/OPW/books/reserved">予約した本</a></td>
        <td></td><td>2026/10/02</td><td></td><td></td>
      </tr>
    </table></div>
  `;

  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    requests.push({ url, init });

    if (url.pathname === '/OPW/OPWUSERINFO.CSP') {
      return new Response(statusHtml);
    }
    if (url.pathname.endsWith('/books/borrowed')) {
      return new Response(
        '<iframe name="AFFILIATE" src="https://affiliate.example/borrowed"></iframe>',
      );
    }
    if (url.pathname.endsWith('/books/reserved')) {
      return new Response(
        '<iframe name="AFFILIATE" src="https://affiliate.example/reserved"></iframe>',
      );
    }
    if (url.hostname === 'affiliate.example') {
      return new Response(
        `<div class="panel-body"><img src="/covers/${url.pathname.slice(1)}.jpg"></div>`,
      );
    }
    return new Response('', {
      headers: { 'set-cookie': 'SID=session; Path=/' },
    });
  };

  try {
    const scraper = createScraper({
      baseUrl: 'https://library.example/OPW',
      cardNo: 'card',
      password: 'password',
      imageUrlCache: {
        async get(title) {
          cacheGets.push(title);
          return cache.get(title) ?? null;
        },
        async set(title, imageUrl) {
          cacheSets.push([title, imageUrl]);
          cache.set(title, imageUrl);
        },
      },
    });

    const status = await scraper.getUserStatus();

    assert.equal(
      status.borrowedBooks[0].imageUrl,
      'https://affiliate.example/covers/borrowed.jpg',
    );
    assert.equal(status.borrowedBooks[0].status, 'まだ更新できません');
    assert.equal(status.borrowedBooks[1].status, '再貸出');
    assert.equal(
      status.reservedBooks[0].imageUrl,
      'https://affiliate.example/covers/reserved.jpg',
    );
    assert.equal(
      requests
        .find(({ url }) => url.hostname === 'affiliate.example')
        .init.headers.has('cookie'),
      false,
    );
    assert.deepEqual(cacheSets, [
      ['借りた本', 'https://affiliate.example/covers/borrowed.jpg'],
      ['予約した本', 'https://affiliate.example/covers/reserved.jpg'],
    ]);

    await scraper.getUserStatus();

    assert.deepEqual(cacheGets, [
      '借りた本',
      '再貸出の本',
      '予約した本',
      '借りた本',
      '再貸出の本',
      '予約した本',
    ]);
    assert.equal(
      requests.filter(({ url }) => url.hostname === 'affiliate.example').length,
      2,
    );
    assert.equal(
      requests.filter(({ url }) => url.pathname.endsWith('/books/borrowed'))
        .length,
      1,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('getNewBooks returns null when publishedOn cannot be parsed', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  const rows = [
    ['Invalid date', '2026.13'],
    ['Valid date', '2026.10'],
  ]
    .map(
      ([title, publishedOn]) => `
        <tr><td>2026/10/01</td><td><input value="${title}"></td>
          <td>${title}</td><td>Author</td><td>Publisher</td>
          <td>${publishedOn}</td><td>○ 在架あり</td></tr>
      `,
    )
    .join('');
  const newBooksHtml = `
    <meta charset="utf-8">
    <div id="contents">
      ${'<div></div>'.repeat(10)}
      <div><table><tr><th>headers</th></tr>${rows}</table></div>
    </div>
  `;

  globalThis.fetch = async (input) => {
    const url = new URL(input);
    requests.push(url);
    return new Response(
      url.pathname.endsWith('/OPWNEWBOOK.CSP') ? newBooksHtml : '',
      { headers: { 'set-cookie': 'SID=session; Path=/' } },
    );
  };

  try {
    const scraper = createScraper({
      baseUrl: 'https://library.example/OPW',
      cardNo: 'card',
      password: 'password',
    });

    const books = await scraper.getNewBooks();

    assert.equal(books[0].publishedOn, null);
    assert.equal(books[1].publishedOn.toString(), '2026-10-01');
    await scraper.getNewBooks(3);

    assert.deepEqual(
      requests
        .filter((url) => url.pathname.endsWith('/OPWNEWBOOK.CSP'))
        .map((url) => url.searchParams.get('PAGE')),
      ['1', '3'],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
