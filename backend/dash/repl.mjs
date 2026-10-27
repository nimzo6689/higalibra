import { createScraper } from '@higalibra/scraping';
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
const evaluateBook = createGeminiBookEvaluator(secret.geminiApiKey);
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

console.info(`
Dash REPL ready (dry-run by default; no library reservations are made).
Try: books = await scraper.getNewBooks()
Try: await evaluateBook(books[0])
Try: await runDash()
To make real reservations locally, explicitly run: await runDash({ dryRun: false })
Research history is stored in ${process.env.DASH_HISTORY_PATH || '.dash-history.json'}.
`);
