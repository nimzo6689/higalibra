import type { Temporal } from '@js-temporal/polyfill';
import type { LibraryScraper } from '@higalibra/scraping';

export interface KeeperUser {
  name: string;
  cardNo: string;
  password: string;
}

export interface VapidCredentials {
  subject: string;
  publicKey: string;
  privateKey: string;
}

export interface KeeperSecret {
  baseUrl: string;
  users: KeeperUser[];
  vapid: VapidCredentials;
}

export interface StoredBorrowedBook {
  barcode: string;
  status: string;
  title: string;
  author: string;
  genre: string;
  loanDate: string;
  returnDate: string;
}

export interface StoredReservedBook {
  rank: string;
  title: string;
  reservedOn: string;
  holdExpiresOn: string | null;
}

export interface StoredUserStatus {
  cardNo: string;
  name: string;
  borrowedBooks: StoredBorrowedBook[];
  reservedBooks: StoredReservedBook[];
}

export interface UserStatusSnapshot {
  lastUpdated: string;
  users: StoredUserStatus[];
}

export interface PushNotice {
  type: 'reservation-ready' | 'return-due';
  title: string;
  message: string;
  bookTitle: string;
  date: string;
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface StatusStore {
  load(): Promise<UserStatusSnapshot | null>;
  save(snapshot: UserStatusSnapshot): Promise<void>;
}

export interface PushSender {
  send(cardNo: string, notice: PushNotice): Promise<void>;
}

export interface KeeperDependencies {
  statusStore: StatusStore;
  pushSender: PushSender;
  createScraper(options: {
    baseUrl: string;
    cardNo: string;
    password: string;
  }): LibraryScraper;
  today?: Temporal.PlainDate;
  now?: () => Date;
  extensionWindowDays?: number;
}

export interface KeeperResult {
  userCount: number;
  extendedBookCount: number;
  notificationCount: number;
  lastUpdated: string;
}
