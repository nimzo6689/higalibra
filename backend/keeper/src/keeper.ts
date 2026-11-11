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

const RETURN_NOTICE_WINDOW_DAYS = 3;

export async function runKeeper(
  secret: KeeperSecret,
  dependencies: KeeperDependencies,
): Promise<KeeperResult> {
  const now = dependencies.now ?? (() => new Date());
  const today =
    dependencies.today ??
    Temporal.PlainDate.from(now().toISOString().slice(0, 10));

  const previous = await dependencies.statusStore.load();
  const previousUsers = new Map(
    previous?.users.map((user) => [user.cardNo, user]) ?? [],
  );
  const updatedUsers: StoredUserStatus[] = [];
  const notices: { cardNo: string; notice: PushNotice }[] = [];
  let extendedBookCount = 0;

  for (const user of secret.users) {
    const scraper = dependencies.createScraper({
      baseUrl: secret.baseUrl,
      cardNo: user.cardNo,
      password: user.password,
    });
    let status = await scraper.getUserStatus();
    const extendedBarcodes = new Set<string>();
    const extensionAttempts = new Map<string, Temporal.PlainDate>();

    for (const book of status.borrowedBooks) {
      if (book.status === '再貸出') {
        const response = await scraper.extendLoan(book.barcode);
        if (response.status >= 400) {
          throw new Error(
            `Loan extension failed for card ${user.cardNo}, barcode ${book.barcode}: HTTP ${response.status}.`,
          );
        }
        extensionAttempts.set(book.barcode, book.returnOn);
      }
    }

    if (extensionAttempts.size > 0) {
      status = await scraper.getUserStatus();
      for (const [barcode, originalReturnOn] of extensionAttempts) {
        const updatedBook = status.borrowedBooks.find(
          (book) => book.barcode === barcode,
        );
        if (
          !updatedBook ||
          Temporal.PlainDate.compare(updatedBook.returnOn, originalReturnOn) <=
            0
        ) {
          throw new Error(
            `Loan extension was not reflected for card ${user.cardNo}, barcode ${barcode}; the return date is still ${updatedBook?.returnOn.toString() ?? 'unavailable'}.`,
          );
        }
        extendedBarcodes.add(barcode);
        extendedBookCount += 1;
      }
    }

    const storedUser = toStoredUser(user.cardNo, user.name, status);
    updatedUsers.push(storedUser);
    notices.push(
      ...findReservationNotices(
        user.cardNo,
        storedUser.reservedBooks,
        previousUsers.get(user.cardNo)?.reservedBooks ?? [],
      ),
      ...findReturnNotices(
        user.cardNo,
        storedUser.borrowedBooks,
        previousUsers.get(user.cardNo)?.borrowedBooks ?? [],
        extendedBarcodes,
        today,
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
    notices.map(({ cardNo, notice }) =>
      dependencies.pushSender.send(cardNo, notice),
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
  cardNo: string,
  name: string,
  status: UserStatus,
): StoredUserStatus {
  return {
    cardNo,
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
    imageUrl: book.imageUrl,
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
    imageUrl: book.imageUrl,
    reservedOn: book.reservedOn.toString(),
    holdExpiresOn: book.expireOn?.toString() ?? null,
  };
}

function findReservationNotices(
  cardNo: string,
  current: StoredReservedBook[],
  previous: StoredReservedBook[],
): { cardNo: string; notice: PushNotice }[] {
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
        cardNo,
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
  cardNo: string,
  books: StoredBorrowedBook[],
  previous: StoredBorrowedBook[],
  extendedBarcodes: Set<string>,
  today: Temporal.PlainDate,
): { cardNo: string; notice: PushNotice }[] {
  const previousByBarcode = new Map(
    previous.map((book) => [book.barcode, book]),
  );

  return books.flatMap((book) => {
    if (extendedBarcodes.has(book.barcode)) {
      return [];
    }
    const previousBook = previousByBarcode.get(book.barcode);
    if (
      previousBook &&
      previousBook.status === book.status &&
      previousBook.title === book.title &&
      previousBook.genre === book.genre &&
      previousBook.loanDate === book.loanDate &&
      previousBook.returnDate === book.returnDate
    ) {
      return [];
    }

    const returnOn = Temporal.PlainDate.from(book.returnDate);
    const daysUntilReturn = daysUntil(returnOn, today);
    if (daysUntilReturn > RETURN_NOTICE_WINDOW_DAYS) {
      return [];
    }

    return [
      {
        cardNo,
        notice: {
          type: 'return-due',
          title: '返却期限が近づいています',
          message: `「${book.title}」の返却期限は${returnOn.toString()}です。`,
          bookTitle: book.title,
          date: returnOn.toString(),
        },
      },
    ];
  });
}
