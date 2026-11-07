import type { LibraryScraper } from '@higalibra/scraping';
import type { PushSender } from '@higalibra/push';
import type { ReservationSettings } from './settings.js';

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
  vapid: VapidCredentials;
}

export type ResearchStatus = 'reservation-pending' | 'reserved';

export interface ResearchRecord {
  reservationCardNo: string;
  bookNo: string;
  title: string;
  author: string;
  publisher: string;
  updatedAt: string;
  status: ResearchStatus;
  notificationSentTo: string[];
}

export interface ResearchHistory {
  version: 2;
  books: ResearchRecord[];
}

export interface ResearchHistoryStore {
  load(): Promise<ResearchHistory>;
  save(history: ResearchHistory): Promise<void>;
}

export interface ReservationSettingsStore {
  load(cardNo: string): Promise<ReservationSettings>;
}

export interface DashDependencies {
  historyStore: ResearchHistoryStore;
  settingsStore: ReservationSettingsStore;
  createScraper(options: {
    baseUrl: string;
    cardNo: string;
    password: string;
  }): LibraryScraper;
  pushSender: PushSender;
  now?: () => Date;
}

export interface DashBookResult {
  reservationCardNo: string;
  bookNo: string;
  title: string;
  status: ResearchStatus | 'dry-run-selected' | 'not-matched' | 'skipped';
}

export interface DashResult {
  fetchedByCardNo: string | null;
  newBookCount: number;
  matchedCount: number;
  skippedCount: number;
  reservedCount: number;
  notificationCount: number;
  dryRun: boolean;
  books: DashBookResult[];
}
