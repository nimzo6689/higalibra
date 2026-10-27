import { readFile, writeFile } from 'node:fs/promises';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import type {
  ResearchHistory,
  ResearchHistoryStore,
  ResearchStatus,
} from './types.js';

export class S3ResearchHistoryStore implements ResearchHistoryStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly key: string,
  ) {}

  async load(): Promise<ResearchHistory> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: this.key }),
      );
      if (!response.Body) {
        throw new Error(
          `Research history s3://${this.bucket}/${this.key} has no body.`,
        );
      }
      return parseResearchHistory(
        JSON.parse(await response.Body.transformToString()) as unknown,
      );
    } catch (error) {
      if (isS3NotFound(error)) {
        return { version: 1, books: [] };
      }
      throw error;
    }
  }

  async save(history: ResearchHistory): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key,
        Body: JSON.stringify(history),
        ContentType: 'application/json; charset=utf-8',
      }),
    );
  }
}

export class FileResearchHistoryStore implements ResearchHistoryStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ResearchHistory> {
    try {
      return parseResearchHistory(
        JSON.parse(await readFile(this.path, 'utf8')) as unknown,
      );
    } catch (error) {
      if (isFileNotFound(error)) {
        return { version: 1, books: [] };
      }
      throw error;
    }
  }

  async save(history: ResearchHistory): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  }
}

export function parseResearchHistory(value: unknown): ResearchHistory {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.books)) {
    throw new Error('Research history has an invalid JSON shape.');
  }
  const books = value.books.map((book, index) => {
    if (!isRecord(book)) {
      throw new Error(`Research history entry ${index} must be an object.`);
    }
    const status = readResearchStatus(book.status);
    const reservationCardNo =
      typeof book.reservationCardNo === 'string'
        ? book.reservationCardNo
        : book.reservationUserId;
    if (
      typeof book.bookNo !== 'string' ||
      typeof book.title !== 'string' ||
      typeof book.author !== 'string' ||
      typeof book.publisher !== 'string' ||
      typeof book.evaluatedAt !== 'string' ||
      typeof book.shouldReserve !== 'boolean' ||
      typeof book.reason !== 'string' ||
      typeof reservationCardNo !== 'string' ||
      !Array.isArray(book.notificationSentTo) ||
      !book.notificationSentTo.every((cardNo) => typeof cardNo === 'string')
    ) {
      throw new Error(`Research history entry ${index} has invalid fields.`);
    }
    return {
      bookNo: book.bookNo,
      title: book.title,
      author: book.author,
      publisher: book.publisher,
      evaluatedAt: book.evaluatedAt,
      shouldReserve: book.shouldReserve,
      reason: book.reason,
      status,
      reservationCardNo,
      notificationSentTo: book.notificationSentTo,
    };
  });
  return { version: 1, books };
}

function readResearchStatus(value: unknown): ResearchStatus {
  if (
    value !== 'not-selected' &&
    value !== 'dry-run-selected' &&
    value !== 'dry-run-not-selected' &&
    value !== 'reservation-pending' &&
    value !== 'reserved'
  ) {
    throw new Error('Research history contains an invalid book status.');
  }
  return value;
}

function isS3NotFound(error: unknown): boolean {
  return (
    isRecord(error) && (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}

function isFileNotFound(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
