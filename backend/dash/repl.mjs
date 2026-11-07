import { createScraper } from '@higalibra/scraping';
import { Temporal } from '@js-temporal/polyfill';
import {
  FileResearchHistoryStore,
  FileReservationSettingsStore,
  runDash as executeDash,
} from './dist/index.js';

const requiredEnvironmentValue = (name) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} in backend/dash/.env.`);
  }
  return value;
};

const secret = {
  baseUrl: requiredEnvironmentValue('HIGALIBRA_BASE_URL'),
  users: [
    {
      name: 'Local user',
      cardNo: requiredEnvironmentValue('HIGALIBRA_CARD_NO'),
      password: requiredEnvironmentValue('HIGALIBRA_PASSWORD'),
    },
  ],
  vapid: {
    subject: 'mailto:local@example.invalid',
    publicKey: 'not-used-in-local-repl',
    privateKey: 'not-used-in-local-repl',
  },
};
const settingsPath =
  process.env.DASH_RESERVATION_SETTINGS_PATH || '.reservation-settings.json';
const historyStore = new FileResearchHistoryStore(
  process.env.DASH_HISTORY_PATH || '.dash-history.json',
);
const settingsStore = new FileReservationSettingsStore(settingsPath);

globalThis.scraper = createScraper({
  baseUrl: secret.baseUrl,
  cardNo: secret.users[0].cardNo,
  password: secret.users[0].password,
});
globalThis.runDash = async ({ dryRun = true } = {}) =>
  executeDash(
    secret,
    {
      historyStore,
      settingsStore,
      createScraper: () => globalThis.scraper,
      pushSender: {
        async send(cardNo, notice) {
          console.info(`Push (local preview) to ${cardNo}:`, notice);
        },
      },
    },
    { dryRun },
  );

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
Try: await runDash()
To make real reservations locally, explicitly run: await runDash({ dryRun: false })
Research history is stored in ${process.env.DASH_HISTORY_PATH || '.dash-history.json'}.
Reservation conditions are loaded from ${settingsPath}.
`);
