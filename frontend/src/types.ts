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

export type ReservationField = 'publishers' | 'authors' | 'titleKeywords';

export interface ReservationRule {
  type: 'rule';
  id: string;
  field: ReservationField;
  join: MatchOperator;
  negate: boolean;
  values: string[];
}

export interface ReservationGroupNode {
  type: 'group';
  id: string;
  join: MatchOperator;
  children: ReservationExpressionNode[];
}

export type ReservationExpressionNode = ReservationRule | ReservationGroupNode;

export interface ReservationExpression {
  children: ReservationExpressionNode[];
}

export interface ReservationSettings {
  expression: ReservationExpression;
}

export interface ReservationTestBook {
  bookNo: string;
  title: string;
  author: string;
  publisher: string;
  acceptanceDate: string | null;
  publishedOn: string | null;
}

export interface ReservationTestResult {
  updatedAt: string | null;
  books: ReservationTestBook[];
}

export type Route =
  '/' | '/borrowed' | '/reservations' | '/barcode' | '/settings';
