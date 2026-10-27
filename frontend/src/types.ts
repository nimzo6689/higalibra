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
  reservedOn: string;
  holdExpiresOn: string | null;
}

export interface LibraryUser {
  userId: string;
  name: string;
  cardNo?: string;
  cardNumber?: string;
  borrowedBooks: BorrowedBook[];
  reservedBooks: ReservedBook[];
}

export interface UserStatusSnapshot {
  lastUpdated: string;
  users: LibraryUser[];
}
