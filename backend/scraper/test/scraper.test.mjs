import assert from 'node:assert/strict';
import test from 'node:test';
import { createScraper } from '../dist/index.js';

test('getUserStatus resolves cover images through book details and affiliate frames', async () => {
  const requests = [];
  const originalFetch = globalThis.fetch;
  const statusHtml = `
    <meta charset="utf-8">
    <div id="ContentLend"><table class="el-table-bordered">
      <tr><th>status</th></tr>
      <tr>
        <td></td><td>更新できません</td><td><a href="books/borrowed">借りた本</a></td>
        <td>一般</td><td>barcode-1</td><td></td><td>2026/10/01</td><td>2026/10/31</td>
      </tr>
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
    });

    const status = await scraper.getUserStatus();

    assert.equal(
      status.borrowedBooks[0].imageUrl,
      'https://affiliate.example/covers/borrowed.jpg',
    );
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});
