import {
  ArrowRight,
  Bell,
  BellOff,
  BookMarked,
  BookOpen,
  Check,
  CircleAlert,
  Clock3,
  LoaderCircle,
  RefreshCw,
  ScanBarcode,
  Sparkles,
} from 'lucide-react';
import { EmptyMessage } from '../components';
import type { BorrowedBook, LibraryUser, ReservedBook, Route } from '../types';
import { formatDate, formatDateTime } from '../utils';

export function HomePage({
  users,
  borrowedCount,
  reservedCount,
  dueBooks,
  readyBooks,
  lastUpdated,
  pushEnabled,
  pushBusy,
  pushError,
  pushMessage,
  onTogglePush,
  onNavigate,
}: {
  users: LibraryUser[];
  borrowedCount: number;
  reservedCount: number;
  dueBooks: { user: LibraryUser; book: BorrowedBook; days: number }[];
  readyBooks: { user: LibraryUser; book: ReservedBook }[];
  lastUpdated?: string;
  pushEnabled: boolean;
  pushBusy: boolean;
  pushError: string;
  pushMessage: string;
  onTogglePush: () => void;
  onNavigate: (route: Route) => void;
}) {
  const userNames = users.map((user) => user.name).join('・');
  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">
            <Sparkles size={14} /> LIBRARY DASHBOARD
          </p>
          <h1>おかえりなさい。</h1>
          <p className="welcome-subtitle">
            {userNames ? `${userNames}さんの` : ''}
            図書館利用状況です。
          </p>
        </div>
      </section>

      <section className="summary-grid" aria-label="利用状況サマリー">
        <button
          className="summary-card borrowed-summary"
          onClick={() => onNavigate('/borrowed')}
        >
          <span className="summary-icon">
            <BookOpen size={20} />
          </span>
          <span className="summary-title">借りている本</span>
          <span className="summary-number">
            {borrowedCount}
            <small>冊</small>
          </span>
          <span className="summary-foot">
            {dueBooks.length > 0 ? (
              <>
                <CircleAlert size={14} /> 返却期限にご注意
              </>
            ) : (
              'すべての利用者の貸出中'
            )}
            <ArrowRight size={15} />
          </span>
        </button>
        <button
          className="summary-card reservation-summary"
          onClick={() => onNavigate('/reservations')}
        >
          <span className="summary-icon">
            <BookMarked size={20} />
          </span>
          <span className="summary-title">予約している本</span>
          <span className="summary-number">
            {reservedCount}
            <small>冊</small>
          </span>
          <span className="summary-foot">
            {readyBooks.length > 0 ? (
              <>
                <Bell size={14} /> 取置済み {readyBooks.length}冊
              </>
            ) : (
              '順番待ちの本をチェック'
            )}
            <ArrowRight size={15} />
          </span>
        </button>
      </section>

      <section className="attention-grid">
        <div className="section-card attention-card">
          <div className="section-heading">
            <div className="heading-icon due-icon">
              <Clock3 size={18} />
            </div>
            <div>
              <h2>返却日の近い本</h2>
              <p>返却期限まであと3日以内</p>
            </div>
            <span className="count-pill due-count">{dueBooks.length}</span>
          </div>
          {dueBooks.length ? (
            <div className="compact-list">
              {dueBooks.slice(0, 3).map(({ user, book, days }) => (
                <div
                  className="compact-book"
                  key={`${user.cardNo}-${book.barcode}`}
                >
                  <span className="mini-book-cover cover-green">
                    <BookOpen size={17} />
                  </span>
                  <div className="compact-book-copy">
                    <strong>{book.title}</strong>
                    <span>
                      {user.name}さん ・ {book.author || '著者情報なし'}
                    </span>
                  </div>
                  <span className={`due-label ${days < 0 ? 'overdue' : ''}`}>
                    {days < 0
                      ? '期限超過'
                      : days === 0
                        ? '今日まで'
                        : `あと${days}日`}
                  </span>
                </div>
              ))}
              {dueBooks.length > 3 && (
                <button
                  className="text-link"
                  onClick={() => onNavigate('/borrowed')}
                >
                  すべて見る <ArrowRight size={14} />
                </button>
              )}
            </div>
          ) : (
            <EmptyMessage
              icon={<Check size={17} />}
              title="今すぐ返却が必要な本はありません"
              text="ゆっくり読書をお楽しみください。"
            />
          )}
        </div>

        <div className="section-card attention-card">
          <div className="section-heading">
            <div className="heading-icon ready-icon">
              <Bell size={18} />
            </div>
            <div>
              <h2>受け取り待ちの本</h2>
              <p>図書館で取置中です</p>
            </div>
            <span className="count-pill ready-count">{readyBooks.length}</span>
          </div>
          {readyBooks.length ? (
            <div className="compact-list">
              {readyBooks.slice(0, 3).map(({ user, book }) => (
                <div
                  className="compact-book"
                  key={`${user.cardNo}-${book.title}-${book.reservedOn}`}
                >
                  <span className="mini-book-cover cover-peach">
                    <BookMarked size={17} />
                  </span>
                  <div className="compact-book-copy">
                    <strong>{book.title}</strong>
                    <span>
                      {user.name}さん ・{' '}
                      {book.holdExpiresOn
                        ? `${formatDate(book.holdExpiresOn)}まで`
                        : ''}
                    </span>
                  </div>
                  <span className="ready-label">取置済</span>
                </div>
              ))}
              {readyBooks.length > 3 && (
                <button
                  className="text-link"
                  onClick={() => onNavigate('/reservations')}
                >
                  すべて見る <ArrowRight size={14} />
                </button>
              )}
            </div>
          ) : (
            <EmptyMessage
              icon={<BookMarked size={17} />}
              title="お迎えを待っている本はありません"
              text="予約した本の状況はここに表示されます。"
            />
          )}
        </div>
      </section>

      <section className="home-bottom-grid">
        <button
          className="barcode-promo"
          onClick={() => onNavigate('/barcode')}
        >
          <span className="promo-icon">
            <ScanBarcode size={23} />
          </span>
          <span className="promo-copy">
            <small>LIBRARY CARD</small>
            <strong>利用証をすぐに表示</strong>
            <span>カウンターで見せるだけ</span>
          </span>
          <ArrowRight className="promo-arrow" size={18} />
          <span className="promo-decoration" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
            <i />
          </span>
        </button>

        <section className="push-card">
          <div className="push-card-icon">
            <Bell size={20} />
          </div>
          <div className="push-card-copy">
            <strong>大切なお知らせを受け取る</strong>
            <span>取置や返却日の通知をお届けします</span>
          </div>
          <button
            className={`push-toggle ${pushEnabled ? 'is-enabled' : ''}`}
            onClick={onTogglePush}
            disabled={pushBusy}
          >
            {pushBusy ? (
              <LoaderCircle className="spin" size={17} />
            ) : pushEnabled ? (
              <>
                <BellOff size={16} /> 通知を解除
              </>
            ) : (
              <>
                <Bell size={16} /> 通知を有効にする
              </>
            )}
          </button>
          {(pushError || pushMessage) && (
            <p
              className={`push-feedback ${pushError ? 'is-error' : ''}`}
              role="status"
            >
              {pushError || pushMessage}
            </p>
          )}
        </section>
      </section>
      {lastUpdated && (
        <p className="updated-note">
          <RefreshCw size={13} /> {formatDateTime(lastUpdated)} に更新
        </p>
      )}
    </div>
  );
}
