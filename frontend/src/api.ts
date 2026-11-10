import type {
  BorrowedBook,
  LibraryUser,
  ReservationExpressionNode,
  ReservationField,
  ReservationSettings,
  ReservationTestBook,
  ReservationTestResult,
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

export async function testReservationSettings(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
  settings: ReservationSettings,
): Promise<ReservationTestResult> {
  const body = JSON.stringify({ settings });
  const response = await fetchWithTokenRefresh(
    new URL('/reservation-settings/test', apiUrl),
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
      const value: unknown = await response.json();
      if (isRecord(value) && typeof value.error === 'string') {
        errorDetail = value.error;
      }
    } catch {
      errorDetail = null;
    }
    throw new Error(
      errorDetail ??
        `予約条件のテストに失敗しました (HTTP ${response.status})。`,
    );
  }
  const value: unknown = await response.json();
  if (
    !isRecord(value) ||
    (typeof value.updatedAt !== 'string' && value.updatedAt !== null) ||
    !Array.isArray(value.books)
  ) {
    throw new Error('予約条件テストの結果形式が正しくありません。');
  }
  return {
    updatedAt: value.updatedAt,
    books: value.books.map((book, index) =>
      parseReservationTestBook(book, index),
    ),
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

function parseReservationTestBook(
  value: unknown,
  index: number,
): ReservationTestBook {
  if (
    !isRecord(value) ||
    typeof value.bookNo !== 'string' ||
    typeof value.title !== 'string' ||
    typeof value.author !== 'string' ||
    typeof value.publisher !== 'string' ||
    (typeof value.acceptanceDate !== 'string' &&
      value.acceptanceDate !== null) ||
    (typeof value.publishedOn !== 'string' && value.publishedOn !== null)
  ) {
    throw new Error(
      `予約条件テストの書籍データ (${index + 1}) が正しくありません。`,
    );
  }
  return {
    bookNo: value.bookNo,
    title: value.title,
    author: value.author,
    publisher: value.publisher,
    acceptanceDate: value.acceptanceDate,
    publishedOn: value.publishedOn,
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
  return { expression: parseReservationExpression(value.expression) };
}

function parseReservationExpression(value: unknown): {
  children: ReservationExpressionNode[];
} {
  if (!isRecord(value) || !Array.isArray(value.children)) {
    throw new Error('予約設定データの形式が正しくありません。');
  }
  const ids = new Set<string>();
  const state = { ids, rules: 0 };
  return {
    children: parseReservationNodes(value.children, 0, state),
  };
}

function parseReservationNodes(
  nodes: unknown[],
  groupDepth: number,
  state: { ids: Set<string>; rules: number },
): ReservationExpressionNode[] {
  return nodes.flatMap((node): ReservationExpressionNode[] => {
    if (
      !isRecord(node) ||
      typeof node.id !== 'string' ||
      node.id.length === 0 ||
      node.id.length > 100
    ) {
      throw new Error('予約条件データの形式が正しくありません。');
    }
    if (state.ids.has(node.id)) {
      throw new Error('予約条件データの形式が正しくありません。');
    }
    state.ids.add(node.id);
    if (node.type === 'group') {
      if (
        groupDepth >= 3 ||
        !isMatchOperator(node.join) ||
        !Array.isArray(node.children)
      ) {
        throw new Error('予約条件データの形式が正しくありません。');
      }
      const children = parseReservationNodes(
        node.children,
        groupDepth + 1,
        state,
      );
      return children.length
        ? [{ type: 'group', id: node.id, join: node.join, children }]
        : [];
    }
    if (
      node.type !== 'rule' ||
      typeof node.field !== 'string' ||
      !isReservationField(node.field) ||
      !isMatchOperator(node.join) ||
      typeof node.negate !== 'boolean' ||
      !Array.isArray(node.values)
    ) {
      throw new Error('予約条件データの形式が正しくありません。');
    }
    state.rules += 1;
    if (state.rules > 60 || node.values.length > 20) {
      throw new Error('予約条件データの形式が正しくありません。');
    }
    const values: string[] = [];
    for (const item of node.values) {
      if (
        typeof item !== 'string' ||
        item.trim() === '' ||
        item.trim().length > 100
      ) {
        throw new Error('予約条件データの形式が正しくありません。');
      }
      values.push(item.trim());
    }
    return values.length
      ? [
          {
            type: 'rule',
            id: node.id,
            field: node.field,
            join: node.join,
            negate: node.negate,
            values,
          },
        ]
      : [];
  });
}

function isMatchOperator(value: unknown): value is 'and' | 'or' {
  return value === 'and' || value === 'or';
}

function isReservationField(value: string): value is ReservationField {
  return (
    value === 'publishers' || value === 'authors' || value === 'titleKeywords'
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
