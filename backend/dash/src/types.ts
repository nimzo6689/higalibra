import type { NewBook, LibraryScraper } from '@higalibra/scraping';
import type { PushSender } from '@higalibra/push';

export interface DashUser {
  name: string;
  cardNo: string;
  password: string;
}

export interface VapidCredentials {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface DashSecret {
  baseUrl: string;
  users: DashUser[];
  reservationCardNo: string;
  geminiApiKey: string;
  vapid: VapidCredentials;
}

export interface BookDecision {
  shouldReserve: boolean;
  reason: string;
}

export type ResearchStatus =
  | 'not-selected'
  | 'dry-run-selected'
  | 'dry-run-not-selected'
  | 'reservation-pending'
  | 'reserved';

export interface ResearchRecord {
  bookNo: string;
  title: string;
  author: string;
  publisher: string;
  evaluatedAt: string;
  shouldReserve: boolean;
  reason: string;
  status: ResearchStatus;
  reservationCardNo: string;
  notificationSentTo: string[];
}

export interface ResearchHistory {
  version: 1;
  books: ResearchRecord[];
}

export interface ResearchHistoryStore {
  load(): Promise<ResearchHistory>;
  save(history: ResearchHistory): Promise<void>;
}

export interface DashDependencies {
  historyStore: ResearchHistoryStore;
  createScraper(options: {
    baseUrl: string;
    cardNo: string;
    password: string;
  }): LibraryScraper;
  evaluateBook(book: NewBook): Promise<BookDecision>;
  pushSender: PushSender;
  now?: () => Date;
}

export interface DashBookResult {
  bookNo: string;
  title: string;
  status: ResearchStatus | 'skipped';
  shouldReserve?: boolean;
  reason?: string;
}

export interface DashResult {
  reservationCardNo: string;
  newBookCount: number;
  evaluatedCount: number;
  skippedCount: number;
  reservedCount: number;
  notificationCount: number;
  dryRun: boolean;
  books: DashBookResult[];
}
