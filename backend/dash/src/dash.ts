import type { NewBook } from '@higalibra/scraping';
import type {
  DashDependencies,
  DashResult,
  DashSecret,
  ResearchHistory,
  ResearchRecord,
} from './types.js';
import {
  hasActiveReservationSettings,
  matchesReservationSettings,
} from './settings.js';

export async function runDash(
  secret: DashSecret,
  dependencies: DashDependencies,
  options: { dryRun?: boolean } = {},
): Promise<DashResult> {
  const dryRun = options.dryRun ?? false;
  const now = dependencies.now ?? (() => new Date());
  const settingsByCardNo = new Map(
    await Promise.all(
      secret.users.map(
        async (user) =>
          [
            user.cardNo,
            await dependencies.settingsStore.load(user.cardNo),
          ] as const,
      ),
    ),
  );
  const eligibleUsers = secret.users.filter((user) => {
    const settings = settingsByCardNo.get(user.cardNo);
    return settings !== undefined && hasActiveReservationSettings(settings);
  });
  const scrapers = new Map<
    string,
    ReturnType<DashDependencies['createScraper']>
  >();
  const getScraper = (cardNo: string) => {
    let scraper = scrapers.get(cardNo);
    if (!scraper) {
      const user = secret.users.find(
        (candidate) => candidate.cardNo === cardNo,
      );
      if (!user) throw new Error(`Dash user card ${cardNo} is not configured.`);
      scraper = dependencies.createScraper({
        baseUrl: secret.baseUrl,
        cardNo: user.cardNo,
        password: user.password,
      });
      scrapers.set(cardNo, scraper);
    }
    return scraper;
  };

  const fetchUser = eligibleUsers[0];
  const [newBooks, loadedHistory] = await Promise.all([
    fetchUser
      ? getScraper(fetchUser.cardNo).getNewBooks()
      : Promise.resolve([] as NewBook[]),
    dependencies.historyStore.load(),
  ]);
  const historyByUserAndBook = new Map(
    loadedHistory.books.map((record) => [
      historyKey(record.reservationCardNo, record.bookNo),
      record,
    ]),
  );
  const results: DashResult['books'] = [];
  let matchedCount = 0;
  let skippedCount = 0;
  let reservedCount = 0;

  for (const book of newBooks) {
    for (const user of eligibleUsers) {
      const key = historyKey(user.cardNo, book.bookNo);
      if (historyByUserAndBook.has(key)) {
        skippedCount += 1;
        results.push({
          reservationCardNo: user.cardNo,
          bookNo: book.bookNo,
          title: book.title,
          status: 'skipped',
        });
        continue;
      }

      const settings = settingsByCardNo.get(user.cardNo);
      if (!settings) {
        throw new Error(
          `Reservation settings for card ${user.cardNo} could not be loaded.`,
        );
      }
      if (!matchesReservationSettings(book, settings)) {
        results.push({
          reservationCardNo: user.cardNo,
          bookNo: book.bookNo,
          title: book.title,
          status: 'not-matched',
        });
        continue;
      }
      matchedCount += 1;

      if (dryRun) {
        results.push({
          reservationCardNo: user.cardNo,
          bookNo: book.bookNo,
          title: book.title,
          status: 'dry-run-selected',
        });
        continue;
      }

      const record: ResearchRecord = {
        reservationCardNo: user.cardNo,
        bookNo: book.bookNo,
        title: book.title,
        author: book.author,
        publisher: book.publisher,
        updatedAt: now().toISOString(),
        status: 'reservation-pending',
        notificationSentTo: [],
      };
      historyByUserAndBook.set(key, record);
      await saveHistory(dependencies, historyByUserAndBook);

      const response = await getScraper(user.cardNo).reserveBook(book.bookNo);
      if (response.status >= 400) {
        throw new Error(
          `Reservation failed for book ${book.bookNo} (${book.title}) on card ${user.cardNo} (HTTP ${response.status}).`,
        );
      }
      record.status = 'reserved';
      record.updatedAt = now().toISOString();
      reservedCount += 1;
      await saveHistory(dependencies, historyByUserAndBook);

      results.push({
        reservationCardNo: user.cardNo,
        bookNo: book.bookNo,
        title: book.title,
        status: record.status,
      });
    }
  }

  let notificationCount = 0;
  const notificationFailures: unknown[] = [];
  if (!dryRun) {
    for (const record of historyByUserAndBook.values()) {
      if (record.status !== 'reserved') continue;
      if (record.notificationSentTo.includes(record.reservationCardNo))
        continue;
      try {
        await dependencies.pushSender.send(record.reservationCardNo, {
          type: 'new-book-reserved',
          title: '新着本を予約しました',
          message: `「${record.title}」を予約しました。`,
          bookTitle: record.title,
          date: now().toISOString().slice(0, 10),
        });
        record.notificationSentTo.push(record.reservationCardNo);
        record.updatedAt = now().toISOString();
        await saveHistory(dependencies, historyByUserAndBook);
        notificationCount += 1;
      } catch (error) {
        notificationFailures.push(error);
      }
    }
  }
  if (notificationFailures.length > 0) {
    throw new AggregateError(
      notificationFailures,
      `Could not send ${notificationFailures.length} Dash notification(s).`,
    );
  }

  return {
    fetchedByCardNo: fetchUser?.cardNo ?? null,
    newBookCount: newBooks.length,
    matchedCount,
    skippedCount,
    reservedCount,
    notificationCount,
    dryRun,
    books: results,
  };
}

function historyKey(cardNo: string, bookNo: string): string {
  return JSON.stringify([cardNo, bookNo]);
}

async function saveHistory(
  dependencies: DashDependencies,
  records: Map<string, ResearchRecord>,
): Promise<void> {
  const history: ResearchHistory = {
    version: 2,
    books: [...records.values()],
  };
  await dependencies.historyStore.save(history);
}
