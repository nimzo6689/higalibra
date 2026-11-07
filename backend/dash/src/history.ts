import { readFile, writeFile } from 'node:fs/promises';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  EMPTY_RESERVATION_SETTINGS,
  parseReservationSettings,
  reservationSettingsObjectKey,
} from './settings.js';
import type { ReservationSettings } from './settings.js';
import type {
  ReservationSettingsStore,
  ResearchHistory,
  ResearchHistoryStore,
  ResearchRecord,
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
        return { version: 2, books: [] };
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

export class S3ReservationSettingsStore implements ReservationSettingsStore {
  constructor(
    private readonly client: S3Client,
    private readonly bucket: string,
    private readonly prefix: string,
  ) {}

  async load(cardNo: string): Promise<ReservationSettings> {
    const key = reservationSettingsObjectKey(this.prefix, cardNo);
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      if (!response.Body) {
        throw new Error(
          `Reservation settings s3://${this.bucket}/${key} has no body.`,
        );
      }
      return parseReservationSettings(
        JSON.parse(await response.Body.transformToString()) as unknown,
      );
    } catch (error) {
      if (isS3NotFound(error)) return EMPTY_RESERVATION_SETTINGS;
      throw error;
    }
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
        return { version: 2, books: [] };
      }
      throw error;
    }
  }

  async save(history: ResearchHistory): Promise<void> {
    await writeFile(this.path, `${JSON.stringify(history, null, 2)}\n`, 'utf8');
  }
}

export class FileReservationSettingsStore implements ReservationSettingsStore {
  constructor(private readonly path: string) {}

  async load(): Promise<ReservationSettings> {
    try {
      return parseReservationSettings(
        JSON.parse(await readFile(this.path, 'utf8')) as unknown,
      );
    } catch (error) {
      if (isFileNotFound(error)) return EMPTY_RESERVATION_SETTINGS;
      throw error;
    }
  }
}

export function parseResearchHistory(value: unknown): ResearchHistory {
  if (
    !isRecord(value) ||
    (value.version !== 1 && value.version !== 2) ||
    !Array.isArray(value.books)
  ) {
    throw new Error('Research history has an invalid JSON shape.');
  }
  const books: ResearchRecord[] = [];
  value.books.forEach((book, index) => {
    if (!isRecord(book)) {
      throw new Error(`Research history entry ${index} must be an object.`);
    }
    const legacy = value.version === 1;
    const status = readResearchStatus(book.status, legacy);
    if (status === null) return;
    const reservationCardNo =
      typeof book.reservationCardNo === 'string'
        ? book.reservationCardNo
        : legacy
          ? book.reservationUserId
          : undefined;
    const updatedAt = legacy ? book.evaluatedAt : book.updatedAt;
    if (
      typeof book.bookNo !== 'string' ||
      typeof book.title !== 'string' ||
      typeof book.author !== 'string' ||
      typeof book.publisher !== 'string' ||
      typeof updatedAt !== 'string' ||
      typeof reservationCardNo !== 'string' ||
      !Array.isArray(book.notificationSentTo) ||
      !book.notificationSentTo.every((cardNo) => typeof cardNo === 'string')
    ) {
      throw new Error(`Research history entry ${index} has invalid fields.`);
    }
    books.push({
      reservationCardNo,
      bookNo: book.bookNo,
      title: book.title,
      author: book.author,
      publisher: book.publisher,
      updatedAt,
      status,
      notificationSentTo: book.notificationSentTo,
    });
  });
  return { version: 2, books };
}

function readResearchStatus(
  value: unknown,
  legacy: boolean,
): ResearchStatus | null {
  if (value === 'reservation-pending' || value === 'reserved') return value;
  if (
    legacy &&
    (value === 'not-selected' ||
      value === 'dry-run-selected' ||
      value === 'dry-run-not-selected')
  ) {
    return null;
  }
  throw new Error('Research history contains an invalid book status.');
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
