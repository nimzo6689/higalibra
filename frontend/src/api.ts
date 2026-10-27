import type {
  BorrowedBook,
  LibraryUser,
  ReservedBook,
  UserStatusSnapshot,
} from './types';

export async function fetchUserStatus(
  url: string,
  idToken: string,
  signal?: AbortSignal,
): Promise<UserStatusSnapshot> {
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${idToken}` },
    cache: 'no-store',
    signal,
  });
  if (!response.ok) {
    throw new Error(
      `利用状況を取得できませんでした (HTTP ${response.status})。`,
    );
  }

  const value: unknown = await response.json();
  if (!isRecord(value) || typeof value.lastUpdated !== 'string') {
    throw new Error('利用状況データの形式が正しくありません。');
  }
  if (!Array.isArray(value.users)) {
    throw new Error('利用者一覧が見つかりません。');
  }

  return {
    lastUpdated: value.lastUpdated,
    users: value.users.map((user, index) => parseUser(user, index)),
  };
}

function parseUser(value: unknown, index: number): LibraryUser {
  const cardNo =
    isRecord(value) && typeof value.cardNo === 'string'
      ? value.cardNo
      : isRecord(value) && typeof value.userId === 'string'
        ? value.userId
        : null;
  if (
    !isRecord(value) ||
    cardNo === null ||
    typeof value.name !== 'string' ||
    !Array.isArray(value.borrowedBooks) ||
    !Array.isArray(value.reservedBooks)
  ) {
    throw new Error(`利用者データ (${index + 1}) の形式が正しくありません。`);
  }

  return {
    cardNo,
    name: value.name,
    borrowedBooks: value.borrowedBooks.map((book, bookIndex) =>
      parseBorrowedBook(book, index, bookIndex),
    ),
    reservedBooks: value.reservedBooks.map((book, bookIndex) =>
      parseReservedBook(book, index, bookIndex),
    ),
  };
}

function parseBorrowedBook(
  value: unknown,
  userIndex: number,
  bookIndex: number,
): BorrowedBook {
  if (
    !isRecord(value) ||
    typeof value.barcode !== 'string' ||
    typeof value.status !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.loanDate !== 'string' ||
    typeof value.returnDate !== 'string'
  ) {
    throw new Error(
      `利用者 ${userIndex + 1} の貸出データ (${bookIndex + 1}) が正しくありません。`,
    );
  }
  return {
    barcode: value.barcode,
    status: value.status,
    title: value.title,
    author: optionalString(value.author),
    genre: optionalString(value.genre),
    coverImageUrl: optionalString(value.coverImageUrl),
    loanDate: value.loanDate,
    returnDate: value.returnDate,
  };
}

function parseReservedBook(
  value: unknown,
  userIndex: number,
  bookIndex: number,
): ReservedBook {
  if (
    !isRecord(value) ||
    typeof value.rank !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.reservedOn !== 'string' ||
    (typeof value.holdExpiresOn !== 'string' && value.holdExpiresOn !== null)
  ) {
    throw new Error(
      `利用者 ${userIndex + 1} の予約データ (${bookIndex + 1}) が正しくありません。`,
    );
  }
  return {
    rank: value.rank,
    title: value.title,
    reservedOn: value.reservedOn,
    holdExpiresOn: value.holdExpiresOn,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
