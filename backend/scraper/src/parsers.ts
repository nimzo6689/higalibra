import { loadBuffer } from 'cheerio';
import { Temporal } from '@js-temporal/polyfill';
import type {
  AvailabilityStatus,
  BookGenre,
  BorrowedBook,
  BorrowedBookStatus,
  NewBook,
  ReservedBook,
  UserStatus,
} from './types.js';

export function parseUserStatus(html: Buffer): UserStatus {
  const $ = loadBuffer(html);

  const borrowedBooks: BorrowedBook[] = $(
    '#ContentLend table.el-table-bordered tr:not(:first-child)',
  )
    .toArray()
    .filter((_, index) => index % 2 === 0)
    .map((row) => {
      const cells = $(row).children('td');
      return {
        status: parseEnum<BorrowedBookStatus>(
          cellText(cells.eq(1)).replace(/\s+/g, ''),
          ['更新回数に達しました。', '再貸出', '更新できません'],
          'status',
        ),
        title: cellText(cells.eq(2)),
        genre: parseEnum<BookGenre>(
          cellText(cells.eq(3)),
          [
            '一般',
            'ティーンズ',
            '児童',
            '雑誌',
            'ＡＶ',
            '電子書籍',
            'ｵｰﾃﾞｨｵﾌﾞｯｸ',
          ],
          'genre',
        ),
        barcode: cellText(cells.eq(4)),
        borrowedOn: parseLibraryDate(cellText(cells.eq(6)), 'borrowedOn'),
        returnOn: parseLibraryDate(cellText(cells.eq(7)), 'returnOn'),
      };
    });

  const reservedBooks: ReservedBook[] = $(
    '#ContentRsv table.el-table-bordered tr:not(:first-child)',
  )
    .toArray()
    .map((row) => {
      const cells = $(row).children('td');
      return {
        ...parseReservationRank(cellText(cells.eq(2))),
        title: cellText(cells.eq(3)),
        reservedOn: parseLibraryDate(cellText(cells.eq(5)), 'reservedOn'),
        expireOn: parseOptionalLibraryDate(cellText(cells.eq(7)), 'expireOn'),
      };
    });

  return { borrowedBooks, reservedBooks };
}

export function parseNewBooks(html: Buffer): NewBook[] {
  const $ = loadBuffer(html);

  return $('#contents div:nth-child(11) table tr:not(:first-child)')
    .toArray()
    .map((row) => {
      const cells = $(row).children('td');
      return {
        acceptanceDate: parseOptionalLibraryDate(
          cellText(cells.eq(0)),
          'acceptanceDate',
        ),
        bookNo: cells.eq(1).find('input').attr('value') ?? '',
        title: cellText(cells.eq(2)),
        author: cellText(cells.eq(3)),
        publisher: cellText(cells.eq(4)),
        publishedOn: parsePublicationDate(cellText(cells.eq(5))),
        availabilityStatus: parseEnum<AvailabilityStatus>(
          cellText(cells.eq(6)),
          ['○ 在架あり', '× 在架なし'],
          'availabilityStatus',
        ),
      };
    });
}

function parseEnum<const T extends string>(
  value: string,
  choices: readonly T[],
  property: string,
): T {
  const choice = choices.find((candidate) => candidate === value);
  if (choice === undefined) {
    throw new Error(
      `Invalid ${property}: received ${JSON.stringify(value)}; expected one of ${choices.map((choice) => JSON.stringify(choice)).join(', ')}.`,
    );
  }
  return choice;
}

function parseReservationRank(value: string): {
  userRank: number;
  totalReservations: number;
} {
  const match = /^(\d+)\s*\/\s*(\d+)$/.exec(value);
  if (!match) {
    throw new Error(
      `Invalid reservation rank: expected "userRank / totalReservations", received ${JSON.stringify(value)}.`,
    );
  }

  const userRank = Number(match[1]);
  const totalReservations = Number(match[2]);
  if (
    !Number.isSafeInteger(userRank) ||
    !Number.isSafeInteger(totalReservations) ||
    userRank < 1 ||
    totalReservations < userRank
  ) {
    throw new Error(
      `Invalid reservation rank: received ${JSON.stringify(value)}.`,
    );
  }

  return { userRank, totalReservations };
}

function parseLibraryDate(value: string, property: string): Temporal.PlainDate {
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(value);
  if (!match) {
    throw new Error(
      `Invalid ${property} date: expected YYYY/MM/DD, received ${JSON.stringify(value)}.`,
    );
  }

  return parsePlainDate(match[1], match[2], match[3], property, value);
}

function parseOptionalLibraryDate(
  value: string,
  property: string,
): Temporal.PlainDate | null {
  return value === '' ? null : parseLibraryDate(value, property);
}

function parsePublicationDate(value: string): Temporal.PlainDate {
  const normalizedValue = value.trim();
  const match = /^(\d{4})(?:\.(\d{1,2}))?$/.exec(normalizedValue);
  if (!match) {
    throw new Error(
      `Invalid publishedOn: expected YYYY or YYYY.M, received ${JSON.stringify(value)}.`,
    );
  }

  return parsePlainDate(match[1], match[2] ?? '1', '1', 'publishedOn', value);
}

function parsePlainDate(
  year: string,
  month: string,
  day: string,
  property: string,
  value: string,
): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(
      {
        year: Number(year),
        month: Number(month),
        day: Number(day),
      },
      { overflow: 'reject' },
    );
  } catch (error) {
    if (error instanceof RangeError) {
      throw new RangeError(
        `Invalid ${property} date: ${JSON.stringify(value)}.`,
        { cause: error },
      );
    }
    throw error;
  }
}

export function extractTokens(html: string | Buffer): string[] {
  const source = typeof html === 'string' ? html : html.toString('latin1');
  return Array.from(
    source.matchAll(/cspHttpServerMethod\(['"]([^'"]+)['"]/g),
    (match) => match[1],
  );
}

export function extractToken(html: string | Buffer, index: number): string {
  const token = extractTokens(html)[index];
  if (!token) {
    throw new Error(`Could not find library event token ${index + 1}.`);
  }
  return token;
}

function cellText(cell: { text(): string }): string {
  return cell.text().trim();
}
