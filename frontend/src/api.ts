import type {
  BorrowedBook,
  LibraryUser,
  ReservationSettings,
  ReservedBook,
  UserStatusSnapshot,
} from './types';
import { fetchWithTokenRefresh } from './auth';
import type { AuthConfiguration, AuthSession } from './auth';
import { sha256Hex } from './sha256';

export async function fetchUserStatus(
  url: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
  signal?: AbortSignal,
): Promise<UserStatusSnapshot> {
  const response = await fetchWithTokenRefresh(
    url,
    {
      headers: { authorization: `Bearer ${idToken}` },
      cache: 'no-store',
      signal,
    },
    configuration,
    idToken,
    onSessionRefresh,
  );
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

export async function executeKeeper(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
): Promise<void> {
  const response = await fetchWithTokenRefresh(
    new URL('/keeper', apiUrl),
    {
      method: 'POST',
      headers: { authorization: `Bearer ${idToken}` },
      cache: 'no-store',
    },
    configuration,
    idToken,
    onSessionRefresh,
  );
  if (!response.ok) {
    throw new Error(`Keeper の実行に失敗しました (HTTP ${response.status})。`);
  }

  const value: unknown = await response.json();
  if (!isRecord(value) || value.success !== true) {
    throw new Error('Keeper の実行に失敗しました。');
  }
}

export async function fetchReservationSettings(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
): Promise<ReservationSettings> {
  const response = await fetchWithTokenRefresh(
    new URL('/reservation-settings', apiUrl),
    {
      headers: { authorization: `Bearer ${idToken}` },
      cache: 'no-store',
    },
    configuration,
    idToken,
    onSessionRefresh,
  );
  if (!response.ok) {
    throw new Error(
      `予約設定を取得できませんでした (HTTP ${response.status})。`,
    );
  }
  const value: unknown = await response.json();
  if (!isRecord(value) || !('settings' in value)) {
    throw new Error('予約設定データの形式が正しくありません。');
  }
  return parseReservationSettings(value.settings);
}

export async function updateReservationSettings(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
  settings: ReservationSettings,
): Promise<ReservationSettings> {
  const body = JSON.stringify({ settings });
  const response = await fetchWithTokenRefresh(
    new URL('/reservation-settings', apiUrl),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'x-amz-content-sha256': await sha256Hex(body),
        'content-type': 'application/json',
      },
      body,
      cache: 'no-store',
    },
    configuration,
    idToken,
    onSessionRefresh,
  );
  if (!response.ok) {
    let errorDetail: string | null = null;
    try {
      const body: unknown = await response.json();
      if (isRecord(body) && typeof body.error === 'string') {
        errorDetail = body.error;
      }
    } catch {
      errorDetail = null;
    }
    throw new Error(
      errorDetail ??
        `予約設定を保存できませんでした (HTTP ${response.status})。`,
    );
  }
  const value: unknown = await response.json();
  if (!isRecord(value) || !('settings' in value)) {
    throw new Error('保存した予約設定の形式が正しくありません。');
  }
  return parseReservationSettings(value.settings);
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
    coverImageUrl:
      optionalString(value.imageUrl) ?? optionalString(value.coverImageUrl),
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
    imageUrl: optionalString(value.imageUrl),
    reservedOn: value.reservedOn,
    holdExpiresOn: value.holdExpiresOn,
  };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseReservationSettings(value: unknown): ReservationSettings {
  if (!isRecord(value)) {
    throw new Error('予約設定データの形式が正しくありません。');
  }
  return {
    publishers: parseReservationCriterion(value.publishers),
    authors: parseReservationCriterion(value.authors),
    titleKeywords: parseReservationCriterion(value.titleKeywords),
  };
}

function parseReservationCriterion(
  value: unknown,
): ReservationSettings['publishers'] {
  if (
    !isRecord(value) ||
    (value.operator !== 'and' && value.operator !== 'or') ||
    !Array.isArray(value.values) ||
    value.values.length > 20
  ) {
    throw new Error('予約条件データの形式が正しくありません。');
  }
  const values: string[] = [];
  for (const item of value.values) {
    if (
      typeof item !== 'string' ||
      item.trim() === '' ||
      item.trim().length > 100
    ) {
      throw new Error('予約条件データの形式が正しくありません。');
    }
    values.push(item.trim());
  }
  return { operator: value.operator, values };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
