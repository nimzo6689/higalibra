import { createScraper } from './dist/index.js';

const baseUrl = process.env.HIGALIBRA_BASE_URL;
if (!baseUrl) {
  throw new Error('Set HIGALIBRA_BASE_URL in backend/scraper/.env.');
}

globalThis.createScraper = (options) => createScraper({ ...options, baseUrl });

// Temporal API の inspect カスタマイズ
[
  'PlainDate',
  'PlainDateTime',
  'Instant',
  'ZonedDateTime',
  'PlainTime',
  'PlainYearMonth',
  'PlainMonthDay',
].forEach((className) => {
  if (typeof Temporal !== 'undefined' && Temporal[className]) {
    Temporal[className].prototype[Symbol.for('nodejs.util.inspect.custom')] =
      function () {
        return this.toString();
      };
  }
});

console.info(
  `
Library scraper REPL ready. Create a scraper with: scraper = createScraper({ cardNo: '...', password: '...' })
Then try: await scraper.getUserStatus() or await scraper.getNewBooks().
Mutations: await scraper.extendLoan(barcode) / await scraper.reserveBook(bookNo).
`,
);
