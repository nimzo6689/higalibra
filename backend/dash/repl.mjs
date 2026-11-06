import { createScraper } from '@higalibra/scraping';
import { Temporal } from '@js-temporal/polyfill';
import { readFileSync } from 'node:fs';
import {
  createBookPrompt,
  createGeminiBookEvaluator,
  FileResearchHistoryStore,
  runDash as executeDash,
} from './dist/index.js';

const requiredEnvironmentValue = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} in backend/dash/.env.`);
  }
  return value;
};

const preferencesPath =
  process.env.DASH_BOOK_PREFERENCES_PATH || '.book-preferences.json';
let preferences = [];
try {
  const parsed = JSON.parse(readFileSync(preferencesPath, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray(parsed.preferences) ||
    !parsed.preferences.every(
      (preference) =>
        typeof preference === 'string' && preference.trim() !== '',
    )
  ) {
    throw new Error(
      `Book preferences in ${preferencesPath} must contain a non-empty-string preferences array.`,
    );
  }
  preferences = parsed.preferences.map((preference) => preference.trim());
} catch (error) {
  if (error?.code !== 'ENOENT') {
    throw error;
  }
  console.warn(
    `Book preferences file ${preferencesPath} was not found; evaluating without reader preferences.`,
  );
}

const secret = {
  baseUrl: requiredEnvironmentValue('HIGALIBRA_BASE_URL'),
  reservationCardNo: requiredEnvironmentValue('HIGALIBRA_CARD_NO'),
  users: [
    {
      name: 'Local user',
      cardNo: requiredEnvironmentValue('HIGALIBRA_CARD_NO'),
      password: requiredEnvironmentValue('HIGALIBRA_PASSWORD'),
    },
  ],
  geminiApiKey: requiredEnvironmentValue('GEMINI_API_KEY'),
  vapid: {
    subject: 'mailto:local@example.invalid',
    publicKey: 'not-used-in-local-repl',
    privateKey: 'not-used-in-local-repl',
  },
};
const evaluateBook = createGeminiBookEvaluator(
  secret.geminiApiKey,
  undefined,
  preferences,
);
const historyStore = new FileResearchHistoryStore(
  process.env.DASH_HISTORY_PATH || '.dash-history.json',
);

globalThis.scraper = createScraper({
  baseUrl: secret.baseUrl,
  cardNo: secret.users[0].cardNo,
  password: secret.users[0].password,
});
globalThis.evaluateBook = evaluateBook;
globalThis.runDash = async ({ dryRun = true } = {}) =>
  executeDash(
    secret,
    {
      historyStore,
      createScraper: () => globalThis.scraper,
      evaluateBook,
      pushSender: {
        async send(cardNo, notice) {
          console.info(`Push (local preview) to ${cardNo}:`, notice);
        },
      },
    },
    { dryRun },
  );
globalThis.createBookPrompt = createBookPrompt;

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

console.info(`
Dash REPL ready (dry-run by default; no library reservations are made).
Try: books = await scraper.getNewBooks()
Try: await evaluateBook(books[0])
Try: await runDash()
To make real reservations locally, explicitly run: await runDash({ dryRun: false })
Research history is stored in ${process.env.DASH_HISTORY_PATH || '.dash-history.json'}.
Book preferences are loaded from ${preferencesPath}.
`);
