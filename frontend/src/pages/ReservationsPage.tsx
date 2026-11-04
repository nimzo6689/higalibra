import { useState } from 'react';
import { ArrowDownWideNarrow, Bell, BookMarked, Check } from 'lucide-react';
import { EmptyPanel, PageIntro, UserBadge, UserFilter } from '../components';
import type { LibraryUser, ReservedBook } from '../types';
import { formatDate, safeCoverUrl } from '../utils';

export function ReservationsPage({ users }: { users: LibraryUser[] }) {
  const [selectedUser, setSelectedUser] = useState('all');
  const books = users
    .filter((user) => selectedUser === 'all' || user.cardNo === selectedUser)
    .flatMap((user) => user.reservedBooks.map((book) => ({ user, book })))
    .sort((a, b) => {
      const readyOrder =
        Number(b.book.holdExpiresOn !== null) -
        Number(a.book.holdExpiresOn !== null);
      const rankA = Number(a.book.rank.split('/')[0]);
      const rankB = Number(b.book.rank.split('/')[0]);
      const rankOrder =
        (Number.isFinite(rankA) ? rankA : Number.POSITIVE_INFINITY) -
        (Number.isFinite(rankB) ? rankB : Number.POSITIVE_INFINITY);
      return (
        readyOrder ||
        rankOrder ||
        a.book.title.localeCompare(b.book.title, 'ja')
      );
    });

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="RESERVATIONS"
        title="予約している本"
        subtitle="順番待ちや、受け取り期限を確認できます。"
        icon={<BookMarked size={22} />}
      />
      <div className="list-toolbar">
        <UserFilter
          users={users}
          selected={selectedUser}
          onChange={setSelectedUser}
        />
        <span className="sort-hint">
          <ArrowDownWideNarrow size={15} /> 取置済み・予約順位順
        </span>
        <span className="total-pill">{books.length}冊</span>
      </div>
      {books.length ? (
        <div className="reservation-list">
          {books.map(({ user, book }) => (
            <ReservationCard
              key={`${user.cardNo}-${book.title}-${book.reservedOn}`}
              user={user}
              book={book}
            />
          ))}
        </div>
      ) : (
        <EmptyPanel
          icon={<BookMarked size={24} />}
          title={
            selectedUser === 'all'
              ? '予約中の本はありません'
              : 'この方の予約はありません'
          }
          text="予約した本の順番や状態をここで確認できます。"
        />
      )}
    </div>
  );
}

export function ReservationCard({
  user,
  book,
}: {
  user: LibraryUser;
  book: ReservedBook;
}) {
  const ready = book.holdExpiresOn !== null;
  const imageUrl = safeCoverUrl(book.imageUrl);
  const [failedImageUrl, setFailedImageUrl] = useState<string>();
  return (
    <article className={`reservation-card ${ready ? 'is-ready' : ''}`}>
      <div
        className={`reservation-cover ${ready ? 'cover-peach' : 'cover-lavender'}`}
      >
        {imageUrl && imageUrl !== failedImageUrl ? (
          <img
            src={imageUrl}
            alt=""
            loading="lazy"
            onError={() => setFailedImageUrl(imageUrl)}
          />
        ) : ready ? (
          <Bell size={21} />
        ) : (
          <BookMarked size={21} />
        )}
      </div>
      <div className="reservation-main">
        <div className="card-user-row">
          <UserBadge name={user.name} />
          <span
            className={`reservation-status ${ready ? 'status-ready' : 'status-waiting'}`}
          >
            {ready ? (
              <>
                <Check size={13} /> 取置済み
              </>
            ) : (
              '順番待ち'
            )}
          </span>
        </div>
        <h2>{book.title}</h2>
        <div className="reservation-meta">
          <span>
            予約日 <strong>{formatDate(book.reservedOn)}</strong>
          </span>
          {ready ? (
            <span className="hold-expiry">
              取置期限 <strong>{formatDate(book.holdExpiresOn!)}</strong>
            </span>
          ) : (
            <span>
              予約順位 <strong>{book.rank}</strong>
            </span>
          )}
        </div>
      </div>
      <span className="reservation-rank">
        {ready ? '受取' : `#${book.rank.split('/')[0]}`}
      </span>
    </article>
  );
}
