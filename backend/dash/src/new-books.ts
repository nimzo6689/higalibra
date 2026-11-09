import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type { LibraryScraper, NewBook } from '@higalibra/scraping';

export const MAX_NEW_BOOK_PAGES = 100;
export const NEW_BOOKS_PAGE_DELAY_MS = 1000;

export interface StoredNewBook {
  bookNo: string;
  title: string;
  author: string;
  publisher: string;
  acceptanceDate: string | null;
  publishedOn: string | null;
  availabilityStatus: NewBook['availabilityStatus'];
}

export interface NewBooksSnapshot {
  version: 1;
  updatedAt: string | null;
  books: StoredNewBook[];
}

export interface NewBooksStore {
  load(): Promise<NewBooksSnapshot>;
  save(snapshot: NewBooksSnapshot): Promise<void>;
}

export class S3NewBooksStore implements NewBooksStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  async load(): Promise<NewBooksSnapshot> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key }),
      );
      if (!response.Body) {
        throw new Error(
          `New books s3://${this.bucket}/${this.key} has no body.`,
        );
      }
      return parseNewBooksSnapshot(
        JSON.parse(await response.Body.transformToString()) as unknown,
      );
    } catch (error) {
      if (isS3NotFound(error)) {
        return { version: 1, updatedAt: null, books: [] };
      }
      throw error;
    }
  }

  async save(snapshot: NewBooksSnapshot): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Body: JSON.stringify(snapshot),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
  }
}

export async function harvestNewBooks(
  scraper: Pick<LibraryScraper, 'getNewBooks'>,
  store: NewBooksStore,
  options: {
    sleep?: (milliseconds: number) => Promise<void>;
    now?: () => Date;
  } = {},
): Promise<NewBooksSnapshot> {
  const previous = await store.load();
  const knownBookNos = new Set(previous.books.map(({ bookNo }) => bookNo));
  const discovered: StoredNewBook[] = [];
  const discoveredBookNos = new Set<string>();
  const pageSignatures = new Set<string>();
  const sleep = options.sleep ?? delay;

  for (let page = 1; page <= MAX_NEW_BOOK_PAGES; page += 1) {
    if (page > 1) await sleep(NEW_BOOKS_PAGE_DELAY_MS);
    const pageBooks = await scraper.getNewBooks(page);
    if (pageBooks.length === 0) break;

    const signature = JSON.stringify(pageBooks.map(({ bookNo }) => bookNo));
    if (pageSignatures.has(signature)) break;
    pageSignatures.add(signature);

    let reachedRegisteredBook = false;
    for (const book of pageBooks) {
      if (knownBookNos.has(book.bookNo)) {
        reachedRegisteredBook = true;
        break;
      }
      if (discoveredBookNos.has(book.bookNo)) continue;
      discoveredBookNos.add(book.bookNo);
      discovered.push(storeBook(book));
    }
    if (reachedRegisteredBook) break;
  }

  const snapshot: NewBooksSnapshot = {
    version: 1,
    updatedAt: (options.now ?? (() => new Date()))().toISOString(),
    books: [...discovered, ...previous.books],
  };
  await store.save(snapshot);
  return snapshot;
}

export function parseNewBooksSnapshot(value: unknown): NewBooksSnapshot {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    (typeof value.updatedAt !== 'string' && value.updatedAt !== null) ||
    !Array.isArray(value.books)
  ) {
    throw new Error('New books snapshot has an invalid JSON shape.');
  }
  return {
    version: 1,
    updatedAt: value.updatedAt,
    books: value.books.map((book, index) => parseStoredBook(book, index)),
  };
}

function storeBook(book: NewBook): StoredNewBook {
  return {
    bookNo: book.bookNo,
    title: book.title,
    author: book.author,
    publisher: book.publisher,
    acceptanceDate: book.acceptanceDate?.toString() ?? null,
    publishedOn: book.publishedOn?.toString() ?? null,
    availabilityStatus: book.availabilityStatus,
  };
}

function parseStoredBook(value: unknown, index: number): StoredNewBook {
  if (
    !isRecord(value) ||
    typeof value.bookNo !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.author !== 'string' ||
    typeof value.publisher !== 'string' ||
    !isNullableString(value.acceptanceDate) ||
    !isNullableString(value.publishedOn) ||
    (value.availabilityStatus !== '○ 在架あり' &&
      value.availabilityStatus !== '× 在架なし')
  ) {
    throw new Error(`New books snapshot entry ${index} has invalid fields.`);
  }
  return {
    bookNo: value.bookNo,
    title: value.title,
    author: value.author,
    publisher: value.publisher,
    acceptanceDate: value.acceptanceDate,
    publishedOn: value.publishedOn,
    availabilityStatus: value.availabilityStatus,
  };
}

function isS3NotFound(error: unknown): boolean {
  return (
    isRecord(error) && (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}

function isNullableString(value: unknown): value is string | null {
  return typeof value === 'string' || value === null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
