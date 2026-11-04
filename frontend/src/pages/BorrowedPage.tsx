import { useState } from 'react';
import { ArrowDownWideNarrow, BookOpen } from 'lucide-react';
import { EmptyPanel, PageIntro, UserBadge, UserFilter } from '../components';
import type { BorrowedBook, LibraryUser, Route } from '../types';
import { coverClass, daysUntil, formatDate, safeCoverUrl } from '../utils';

function daysUntilSortableReturnDate(book: BorrowedBook): number {
  const renewalDays =
    book.status === '再貸出' || book.status === 'まだ更新できません'
      ? 14
      : 0;
  return daysUntil(book.returnDate) + renewalDays;
}

export function BorrowedPage({
  users,
  onNavigate,
}: {
  users: LibraryUser[];
  onNavigate: (route: Route) => void;
}) {
  const [selectedUser, setSelectedUser] = useState('all');
  const books = users
    .filter((user) => selectedUser === 'all' || user.cardNo === selectedUser)
    .flatMap((user) => user.borrowedBooks.map((book) => ({ user, book })))
    .sort(
      (a, b) =>
        daysUntilSortableReturnDate(a.book) -
        daysUntilSortableReturnDate(b.book),
    );

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="BORROWED BOOKS"
        title="貸出中の本"
        subtitle="登録利用者が借りている本の一覧です。"
        icon={<BookOpen size={22} />}
      />
      <div className="list-toolbar">
        <UserFilter
          users={users}
          selected={selectedUser}
          onChange={setSelectedUser}
        />
        <span className="sort-hint">
          <ArrowDownWideNarrow size={15} /> 返却期限が近い順
        </span>
        <span className="total-pill">{books.length}冊</span>
      </div>
      {books.length ? (
        <div className="book-grid">
          {books.map(({ user, book }) => (
            <BorrowedBookCard
              key={`${user.cardNo}-${book.barcode}`}
              user={user}
              book={book}
            />
          ))}
        </div>
      ) : (
        <EmptyPanel
          icon={<BookOpen size={24} />}
          title={
            selectedUser === 'all'
              ? '貸出中の本はありません'
              : 'この方の貸出中の本はありません'
          }
          text="新しい本を借りると、ここに表示されます。"
          action="利用証を表示"
          onAction={() => onNavigate('/barcode')}
        />
      )}
    </div>
  );
}

export function BorrowedBookCard({
  user,
  book,
}: {
  user: LibraryUser;
  book: BorrowedBook;
}) {
  const days = daysUntil(book.returnDate);
  return (
    <article className={`borrowed-card ${days <= 3 ? 'is-due' : ''}`}>
      <div className={`book-cover ${coverClass(book.title)}`}>
        {safeCoverUrl(book.coverImageUrl) ? (
          <img src={safeCoverUrl(book.coverImageUrl)} alt="" loading="lazy" />
        ) : (
          <>
            <BookOpen size={23} strokeWidth={1.5} />
            <span>{book.genre || 'LIBRARY'}</span>
          </>
        )}
      </div>
      <div className="borrowed-card-body">
        <div className="card-user-row">
          <UserBadge name={user.name} />
          {book.genre && <span className="genre-label">{book.genre}</span>}
        </div>
        <h2>{book.title}</h2>
        <p className="book-author">{book.author || '著者情報なし'}</p>
        <div className="book-meta">
          <div>
            <span>貸出日</span>
            <strong>{formatDate(book.loanDate)}</strong>
          </div>
          <div className={days <= 3 ? 'return-date-soon' : ''}>
            <span>返却期限</span>
            <strong>{formatDate(book.returnDate)}</strong>
          </div>
        </div>
        <div className="book-card-footer">
          <span className={`book-status ${days <= 3 ? 'status-warning' : ''}`}>
            {book.status || '貸出中'}
          </span>
          {days <= 3 && (
            <span className={`due-label ${days < 0 ? 'overdue' : ''}`}>
              {days < 0
                ? '期限超過'
                : days === 0
                  ? '今日まで'
                  : `あと${days}日`}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
