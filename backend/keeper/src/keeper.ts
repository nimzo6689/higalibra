import { Temporal } from '@js-temporal/polyfill';
import type {
  BorrowedBook,
  ReservedBook,
  UserStatus,
} from '@higalibra/scraping';
import type {
  KeeperDependencies,
  KeeperResult,
  KeeperSecret,
  PushNotice,
  StoredBorrowedBook,
  StoredReservedBook,
  StoredUserStatus,
  UserStatusSnapshot,
} from './types.js';

const DEFAULT_EXTENSION_WINDOW_DAYS = 3;

export async function runKeeper(
  secret: KeeperSecret,
  dependencies: KeeperDependencies,
): Promise<KeeperResult> {
  const now = dependencies.now ?? (() => new Date());
  const today =
    dependencies.today ??
    Temporal.PlainDate.from(now().toISOString().slice(0, 10));
  const extensionWindowDays =
    dependencies.extensionWindowDays ?? DEFAULT_EXTENSION_WINDOW_DAYS;
  if (!Number.isSafeInteger(extensionWindowDays) || extensionWindowDays < 0) {
    throw new RangeError('extensionWindowDays must be a non-negative integer.');
  }

  const previous = await dependencies.statusStore.load();
  const previousUsers = new Map(
    previous?.users.map((user) => [user.userId, user]) ?? [],
  );
  const updatedUsers: StoredUserStatus[] = [];
  const notices: { userId: string; notice: PushNotice }[] = [];
  let extendedBookCount = 0;

  for (const user of secret.users) {
    const scraper = dependencies.createScraper({
      baseUrl: secret.baseUrl,
      cardNo: user.cardNo,
      password: user.password,
    });
    let status = await scraper.getUserStatus();
    const extendedBarcodes = new Set<string>();

    for (const book of status.borrowedBooks) {
      const daysUntilReturn = daysUntil(book.returnOn, today);
      if (
        book.status === '再貸出' &&
        daysUntilReturn >= 0 &&
        daysUntilReturn <= extensionWindowDays
      ) {
        const response = await scraper.extendLoan(book.barcode);
        if (response.status >= 400) {
          throw new Error(
            `Loan extension failed for user ${user.userId}, barcode ${book.barcode}: HTTP ${response.status}.`,
          );
        }
        extendedBarcodes.add(book.barcode);
        extendedBookCount += 1;
      }
    }

    if (extendedBarcodes.size > 0) {
      status = await scraper.getUserStatus();
    }

    const storedUser = toStoredUser(user.userId, user.name, status);
    updatedUsers.push(storedUser);
    notices.push(
      ...findReservationNotices(
        user.userId,
        storedUser.reservedBooks,
        previousUsers.get(user.userId)?.reservedBooks ?? [],
      ),
      ...findReturnNotices(
        user.userId,
        status.borrowedBooks,
        extendedBarcodes,
        today,
        extensionWindowDays,
      ),
    );
  }

  const lastUpdated = now().toISOString();
  const snapshot: UserStatusSnapshot = {
    lastUpdated,
    users: updatedUsers,
  };
  await dependencies.statusStore.save(snapshot);

  const pushResults = await Promise.allSettled(
    notices.map(({ userId, notice }) =>
      dependencies.pushSender.send(userId, notice),
    ),
  );
  const pushFailures = pushResults.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );
  if (pushFailures.length > 0) {
    throw new AggregateError(
      pushFailures,
      `Could not send ${pushFailures.length} keeper notification(s).`,
    );
  }

  return {
    userCount: updatedUsers.length,
    extendedBookCount,
    notificationCount: notices.length,
    lastUpdated,
  };
}

function daysUntil(
  returnOn: Temporal.PlainDate,
  today: Temporal.PlainDate,
): number {
  return today.until(returnOn, { largestUnit: 'day' }).days;
}

function toStoredUser(
  userId: string,
  name: string,
  status: UserStatus,
): StoredUserStatus {
  return {
    userId,
    name,
    borrowedBooks: status.borrowedBooks.map(toStoredBorrowedBook),
    reservedBooks: status.reservedBooks.map(toStoredReservedBook),
  };
}

function toStoredBorrowedBook(book: BorrowedBook): StoredBorrowedBook {
  return {
    barcode: book.barcode,
    status: book.status,
    title: book.title,
    author: '',
    genre: book.genre,
    loanDate: book.borrowedOn.toString(),
    returnDate: book.returnOn.toString(),
  };
}

function toStoredReservedBook(book: ReservedBook): StoredReservedBook {
  return {
    rank: `${book.userRank}/${book.totalReservations}`,
    title: book.title,
    reservedOn: book.reservedOn.toString(),
    holdExpiresOn: book.expireOn?.toString() ?? null,
  };
}

function findReservationNotices(
  userId: string,
  current: StoredReservedBook[],
  previous: StoredReservedBook[],
): { userId: string; notice: PushNotice }[] {
  return current.flatMap((book) => {
    if (book.holdExpiresOn === null) {
      return [];
    }
    const wasOnHold = previous.some(
      (oldBook) =>
        oldBook.title === book.title &&
        oldBook.reservedOn === book.reservedOn &&
        oldBook.holdExpiresOn !== null,
    );
    if (wasOnHold) {
      return [];
    }

    return [
      {
        userId,
        notice: {
          type: 'reservation-ready',
          title: '予約した本が取置済みです',
          message: `「${book.title}」の取置期限は${book.holdExpiresOn}です。`,
          bookTitle: book.title,
          date: book.holdExpiresOn,
        },
      },
    ];
  });
}

function findReturnNotices(
  userId: string,
  books: BorrowedBook[],
  extendedBarcodes: Set<string>,
  today: Temporal.PlainDate,
  extensionWindowDays: number,
): { userId: string; notice: PushNotice }[] {
  return books.flatMap((book) => {
    if (extendedBarcodes.has(book.barcode)) {
      return [];
    }
    const daysUntilReturn = daysUntil(book.returnOn, today);
    if (daysUntilReturn > extensionWindowDays) {
      return [];
    }

    return [
      {
        userId,
        notice: {
          type: 'return-due',
          title: '返却期限が近づいています',
          message: `「${book.title}」の返却期限は${book.returnOn.toString()}です。`,
          bookTitle: book.title,
          date: book.returnOn.toString(),
        },
      },
    ];
  });
}
