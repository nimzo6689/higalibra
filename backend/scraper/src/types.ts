import type { Temporal } from '@js-temporal/polyfill';

export interface ScraperOptions {
  baseUrl: string;
  cardNo: string;
  password: string;
}

export type BorrowedBookStatus =
  '更新回数に達しました。' | '再貸出' | '更新できません';

export type BookGenre =
  '一般' | 'ティーンズ' | '児童' | '雑誌' | 'ＡＶ' | '電子書籍' | 'ｵｰﾃﾞｨｵﾌﾞｯｸ';

export type AvailabilityStatus = '○ 在架あり' | '× 在架なし';

export interface BorrowedBook {
  status: BorrowedBookStatus;
  title: string;
  genre: BookGenre;
  barcode: string;
  borrowedOn: Temporal.PlainDate;
  returnOn: Temporal.PlainDate;
}

export interface ReservedBook {
  userRank: number;
  totalReservations: number;
  title: string;
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
  publishedOn: Temporal.PlainDate; // 月初日として保持
  availabilityStatus: AvailabilityStatus;
}

export interface LibraryScraper {
  getUserStatus(): Promise<UserStatus>;
  getNewBooks(): Promise<NewBook[]>;
  extendLoan(barcode: string): Promise<Response>;
  reserveBook(bookNo: string): Promise<Response>;
}
