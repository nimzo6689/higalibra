import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createScraper } from '@higalibra/scraping';
import { harvestNewBooks, parseNewBooksSnapshot } from './dist/index.js';

function requiredEnvironmentValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Set ${name} in backend/dash/.env.`);
  }
  return value;
}

const outputPath = path.resolve(
  process.env.DASH_NEW_BOOKS_PATH?.trim() || 'dash_new_books.json',
);

const store = {
  async load() {
    try {
      return parseNewBooksSnapshot(
        JSON.parse(await readFile(outputPath, 'utf8')),
      );
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return { version: 1, updatedAt: null, books: [] };
      }
      throw error;
    }
  },
  async save(snapshot) {
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  },
};

const snapshot = await harvestNewBooks(
  createScraper({
    baseUrl: requiredEnvironmentValue('HIGALIBRA_BASE_URL'),
    cardNo: requiredEnvironmentValue('HIGALIBRA_CARD_NO'),
    password: requiredEnvironmentValue('HIGALIBRA_PASSWORD'),
  }),
  store,
);

console.info(
  `Saved ${snapshot.books.length} books (updated ${snapshot.updatedAt}) to ${outputPath}.`,
);
