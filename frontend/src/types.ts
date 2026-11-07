export interface BorrowedBook {
  barcode: string;
  status: string;
  title: string;
  author?: string;
  genre?: string;
  coverImageUrl?: string;
  loanDate: string;
  returnDate: string;
}

export interface ReservedBook {
  rank: string;
  title: string;
  imageUrl?: string;
  reservedOn: string;
  holdExpiresOn: string | null;
}

export interface LibraryUser {
  cardNo: string;
  name: string;
  borrowedBooks: BorrowedBook[];
  reservedBooks: ReservedBook[];
}

export interface UserStatusSnapshot {
  lastUpdated: string;
  users: LibraryUser[];
}

export type MatchOperator = 'and' | 'or';

export interface ReservationCriterion {
  operator: MatchOperator;
  values: string[];
}

export interface ReservationSettings {
  publishers: ReservationCriterion;
  authors: ReservationCriterion;
  titleKeywords: ReservationCriterion;
}

export type Route =
  '/' | '/borrowed' | '/reservations' | '/barcode' | '/settings';
