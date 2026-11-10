import type { Temporal } from '@js-temporal/polyfill';

export interface ScraperOptions {
  baseUrl: string;
  cardNo: string;
  password: string;
  imageUrlCache?: ImageUrlCache;
}

export interface ImageUrlCache {
  get(title: string): Promise<string | null>;
  set(title: string, imageUrl: string): Promise<void>;
}

export type BorrowedBookStatus =
  '更新回数に達しました。' | '再貸出' | 'まだ更新できません' | '予約待ちあり';

export type BookGenre =
  '一般' | 'ティーンズ' | '児童' | '雑誌' | 'ＡＶ' | '電子書籍' | 'ｵｰﾃﾞｨｵﾌﾞｯｸ';

export type AvailabilityStatus = '○ 在架あり' | '× 在架なし';

export interface BorrowedBook {
  status: BorrowedBookStatus;
  title: string;
  imageUrl: string | null;
  genre: BookGenre;
  barcode: string;
  borrowedOn: Temporal.PlainDate;
  returnOn: Temporal.PlainDate;
}

export interface ReservedBook {
  userRank: number;
  totalReservations: number;
  title: string;
  imageUrl: string | null;
  reservedOn: Temporal.PlainDate;
  expireOn: Temporal.PlainDate | null;
}

export interface UserStatus {
  borrowedBooks: BorrowedBook[];
  reservedBooks: ReservedBook[];
}

export interface NewBook {
  acceptanceDate: Temporal.PlainDate | null;
  bookNo: string;
  title: string;
  author: string;
  publisher: string;
  publishedOn: Temporal.PlainDate | null; // 月初日として保持
  availabilityStatus: AvailabilityStatus;
}

export type NewBooksSpan = 1 | 2 | 3 | 4;

export interface LibraryScraper {
  getUserStatus(): Promise<UserStatus>;
  getNewBooks(page?: number): Promise<NewBook[]>;
  setNewBooksSpan(span: NewBooksSpan): Promise<void>;
  extendLoan(barcode: string): Promise<Response>;
  reserveBook(bookNo: string): Promise<Response>;
}
