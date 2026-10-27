import { useCallback, useEffect, useMemo, useState } from 'react';
import JsBarcode from 'jsbarcode';
import {
  ArrowDownWideNarrow,
  ArrowRight,
  Bell,
  BellOff,
  BookMarked,
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  Home,
  LibraryBig,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ScanBarcode,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { fetchUserStatus } from './api';
import {
  beginLogin,
  completeLogin,
  getAuthConfiguration,
  readSession,
  signOut,
  type AuthSession,
} from './auth';
import { disablePush, enablePush, hasPushSubscription } from './push';
import type {
  BorrowedBook,
  LibraryUser,
  ReservedBook,
  UserStatusSnapshot,
} from './types';

type Route = '/' | '/borrowed' | '/reservations' | '/barcode';

const navigation = [
  { route: '/', label: 'ホーム', icon: Home },
  { route: '/borrowed', label: '貸出', icon: BookOpen },
  { route: '/reservations', label: '予約', icon: BookMarked },
  { route: '/barcode', label: '利用証', icon: ScanBarcode },
] as const;

const authConfiguration = getAuthConfiguration();

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [snapshot, setSnapshot] = useState<UserStatusSnapshot | null>(null);
  const [dataError, setDataError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [route, setRoute] = useState<Route>(readRoute());
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [pushMessage, setPushMessage] = useState('');

  useEffect(() => {
    let active = true;
    async function initializeAuth() {
      try {
        const oauthError = new URLSearchParams(window.location.search).get(
          'error_description',
        );
        if (oauthError) {
          window.history.replaceState({}, '', window.location.pathname);
          throw new Error(decodeURIComponent(oauthError.replace(/\+/g, ' ')));
        }
        const callbackSession = authConfiguration
          ? await completeLogin(authConfiguration)
          : null;
        if (active) setSession(callbackSession ?? readSession());
      } catch (error) {
        if (active) setAuthError(errorMessage(error));
      } finally {
        if (active) setAuthReady(true);
      }
    }
    void initializeAuth();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return;
    }
    const statusUrl = import.meta.env.VITE_STATUS_URL?.trim();
    if (!statusUrl) {
      setDataError('VITE_STATUS_URL が設定されていません。');
      return;
    }

    const controller = new AbortController();
    setIsLoading(true);
    setDataError('');
    fetchUserStatus(statusUrl, session.idToken, controller.signal)
      .then(setSnapshot)
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDataError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [session]);

  useEffect(() => {
    function onPopState() {
      setRoute(readRoute());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!session || !('serviceWorker' in navigator)) return;
    void hasPushSubscription()
      .then(setPushEnabled)
      .catch((error: unknown) => setPushError(errorMessage(error)));
  }, [session]);

  const changeRoute = useCallback((nextRoute: Route) => {
    if (window.location.pathname !== nextRoute) {
      window.history.pushState({}, '', nextRoute);
    }
    setRoute(nextRoute);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const refreshStatus = useCallback(() => {
    setSnapshot(null);
    setDataError('');
    setIsLoading(true);
    const statusUrl = import.meta.env.VITE_STATUS_URL?.trim();
    if (!statusUrl || !session) {
      setIsLoading(false);
      setDataError('利用状況の接続設定がありません。');
      return;
    }
    void fetchUserStatus(statusUrl, session.idToken)
      .then(setSnapshot)
      .catch((error: unknown) => setDataError(errorMessage(error)))
      .finally(() => setIsLoading(false));
  }, [session]);

  async function togglePush() {
    if (!session) return;
    const apiUrl = import.meta.env.VITE_PUSH_API_URL?.trim();
    const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY?.trim();
    setPushError('');
    setPushMessage('');
    if (!apiUrl || (!pushEnabled && !vapidPublicKey)) {
      setPushError('通知 API または VAPID 公開鍵の設定がありません。');
      return;
    }
    setPushBusy(true);
    try {
      if (pushEnabled) {
        await disablePush(apiUrl, session.idToken);
        setPushEnabled(false);
        setPushMessage('この端末の通知を解除しました。');
      } else {
        if (!vapidPublicKey) {
          throw new Error('VAPID 公開鍵の設定がありません。');
        }
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('ブラウザーの通知を許可してください。');
        }
        await enablePush(apiUrl, session.idToken, vapidPublicKey);
        setPushEnabled(true);
        setPushMessage('この端末で通知を受け取れます。');
      }
    } catch (error) {
      setPushError(errorMessage(error));
    } finally {
      setPushBusy(false);
    }
  }

  const users = snapshot?.users ?? [];
  const borrowedCount = users.reduce(
    (count, user) => count + user.borrowedBooks.length,
    0,
  );
  const reservedCount = users.reduce(
    (count, user) => count + user.reservedBooks.length,
    0,
  );
  const dueBooks = useMemo(
    () =>
      users.flatMap((user) =>
        user.borrowedBooks
          .map((book) => ({ user, book, days: daysUntil(book.returnDate) }))
          .filter(({ days }) => days <= 3),
      ),
    [users],
  );
  const readyBooks = useMemo(
    () =>
      users.flatMap((user) =>
        user.reservedBooks
          .filter((book) => book.holdExpiresOn !== null)
          .map((book) => ({ user, book })),
      ),
    [users],
  );

  if (!authReady) {
    return <LoadingScreen label="ログイン状態を確認しています" />;
  }

  if (!session) {
    return (
      <LoginScreen
        error={authError}
        onLogin={() => {
          if (!authConfiguration) {
            setAuthError('Cognito のログイン設定がありません。');
            return;
          }
          void beginLogin(authConfiguration).catch((error: unknown) =>
            setAuthError(errorMessage(error)),
          );
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="desktop-sidebar">
        <Brand />
        <p className="sidebar-label">LIBRARY</p>
        <Navigation route={route} onNavigate={changeRoute} />
        <div className="sidebar-bottom">
          <div className="secure-note">
            <ShieldCheck size={18} />
            <span>
              家族だけの
              <br />
              プライベートな記録
            </span>
          </div>
          <button
            className="profile-button"
            onClick={() => {
              if (authConfiguration) signOut(authConfiguration);
            }}
          >
            <span className="avatar avatar-small">家</span>
            <span className="profile-copy">
              <strong>ファミリー</strong>
              <small>ログアウト</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand">
            <Brand />
          </div>
          <div className="topbar-right">
            <span className="sync-status">
              <span className={`sync-dot ${snapshot ? 'is-online' : ''}`} />
              {snapshot ? '同期済み' : '未同期'}
            </span>
            <button
              className="icon-button"
              onClick={refreshStatus}
              aria-label="利用状況を更新"
              title="利用状況を更新"
              disabled={isLoading}
            >
              <RefreshCw className={isLoading ? 'spin' : ''} size={18} />
            </button>
            <button
              className="mobile-profile"
              onClick={() => {
                if (authConfiguration) signOut(authConfiguration);
              }}
              aria-label="ログアウト"
            >
              <span className="avatar avatar-small">家</span>
            </button>
          </div>
        </header>

        <main className="page-content">
          {dataError && (
            <div className="notice notice-error" role="alert">
              <CircleAlert size={19} />
              <div>
                <strong>データを読み込めません</strong>
                <p>{dataError}</p>
              </div>
              <button onClick={refreshStatus} className="notice-action">
                再試行
              </button>
            </div>
          )}

          {isLoading && !snapshot ? (
            <LoadingScreen label="利用状況を読み込んでいます" inline />
          ) : (
            <>
              {route === '/' && (
                <HomePage
                  users={users}
                  borrowedCount={borrowedCount}
                  reservedCount={reservedCount}
                  dueBooks={dueBooks}
                  readyBooks={readyBooks}
                  lastUpdated={snapshot?.lastUpdated}
                  pushEnabled={pushEnabled}
                  pushBusy={pushBusy}
                  pushError={pushError}
                  pushMessage={pushMessage}
                  onTogglePush={togglePush}
                  onNavigate={changeRoute}
                />
              )}
              {route === '/borrowed' && (
                <BorrowedPage users={users} onNavigate={changeRoute} />
              )}
              {route === '/reservations' && <ReservationsPage users={users} />}
              {route === '/barcode' && <BarcodePage users={users} />}
            </>
          )}
        </main>

        <footer className="page-footer">
          <span>家族の図書館ノート</span>
          {snapshot?.lastUpdated && (
            <span>最終更新 {formatDateTime(snapshot.lastUpdated)}</span>
          )}
        </footer>
      </div>

      <div className="mobile-nav-wrap">
        <Navigation route={route} onNavigate={changeRoute} />
      </div>
    </div>
  );
}

function Brand() {
  return (
    <a className="brand" href="/" aria-label="図書館ノート ホーム">
      <span className="brand-mark">
        <LibraryBig size={21} strokeWidth={2.2} />
      </span>
      <span className="brand-text">
        <strong>図書館ノート</strong>
        <small>FAMILY LIBRARY</small>
      </span>
    </a>
  );
}

function Navigation({
  route,
  onNavigate,
}: {
  route: Route;
  onNavigate: (route: Route) => void;
}) {
  return (
    <nav className="navigation" aria-label="メインメニュー">
      {navigation.map(({ route: itemRoute, label, icon: Icon }) => (
        <button
          key={itemRoute}
          className={`nav-item ${route === itemRoute ? 'active' : ''}`}
          onClick={() => onNavigate(itemRoute)}
          aria-current={route === itemRoute ? 'page' : undefined}
        >
          <Icon size={20} strokeWidth={route === itemRoute ? 2.2 : 1.8} />
          <span>{label}</span>
          {route === itemRoute && <span className="nav-active-dot" />}
        </button>
      ))}
    </nav>
  );
}

function HomePage({
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
  const familyNames = users.map((user) => user.name).join('・');
  return (
    <div className="page-stack">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">
            <Sparkles size={14} /> YOUR FAMILY LIBRARY
          </p>
          <h1>おかえりなさい。</h1>
          <p className="welcome-subtitle">
            {familyNames ? `${familyNames}さんの` : '家族みんなの'}
            図書館の記録です。
          </p>
        </div>
        <button className="date-chip" onClick={() => onNavigate('/borrowed')}>
          <CalendarDays size={16} />
          {formatToday()}
          <ArrowRight size={15} />
        </button>
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
              '家族みんなの貸出中'
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
                  key={`${user.userId}-${book.barcode}`}
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
                  key={`${user.userId}-${book.title}-${book.reservedOn}`}
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

function BorrowedPage({
  users,
  onNavigate,
}: {
  users: LibraryUser[];
  onNavigate: (route: Route) => void;
}) {
  const [selectedUser, setSelectedUser] = useState('all');
  const books = users
    .filter((user) => selectedUser === 'all' || user.userId === selectedUser)
    .flatMap((user) => user.borrowedBooks.map((book) => ({ user, book })))
    .sort(
      (a, b) => daysUntil(a.book.returnDate) - daysUntil(b.book.returnDate),
    );

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="BORROWED BOOKS"
        title="貸出中の本"
        subtitle="家族みんなが今読んでいる本の一覧です。"
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
              key={`${user.userId}-${book.barcode}`}
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

function BorrowedBookCard({
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

function ReservationsPage({ users }: { users: LibraryUser[] }) {
  const [selectedUser, setSelectedUser] = useState('all');
  const books = users
    .filter((user) => selectedUser === 'all' || user.userId === selectedUser)
    .flatMap((user) => user.reservedBooks.map((book) => ({ user, book })))
    .sort((a, b) => {
      const readyOrder =
        Number(b.book.holdExpiresOn !== null) -
        Number(a.book.holdExpiresOn !== null);
      return readyOrder || a.book.title.localeCompare(b.book.title, 'ja');
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
          <ArrowDownWideNarrow size={15} /> 取置済み優先
        </span>
        <span className="total-pill">{books.length}冊</span>
      </div>
      {books.length ? (
        <div className="reservation-list">
          {books.map(({ user, book }) => (
            <ReservationCard
              key={`${user.userId}-${book.title}-${book.reservedOn}`}
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

function ReservationCard({
  user,
  book,
}: {
  user: LibraryUser;
  book: ReservedBook;
}) {
  const ready = book.holdExpiresOn !== null;
  return (
    <article className={`reservation-card ${ready ? 'is-ready' : ''}`}>
      <div
        className={`reservation-cover ${ready ? 'cover-peach' : 'cover-lavender'}`}
      >
        {ready ? <Bell size={21} /> : <BookMarked size={21} />}
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

function BarcodePage({ users }: { users: LibraryUser[] }) {
  const [selectedUserId, setSelectedUserId] = useState(users[0]?.userId ?? '');
  const selectedUser =
    users.find((user) => user.userId === selectedUserId) ?? users[0];
  const cardNumber = selectedUser?.cardNo ?? selectedUser?.cardNumber;

  useEffect(() => {
    if (!cardNumber) return;
    const element = document.getElementById('library-barcode');
    if (!(element instanceof SVGSVGElement)) return;
    try {
      JsBarcode(element, cardNumber, {
        format: 'CODE128',
        displayValue: false,
        height: 106,
        margin: 0,
        width: 2,
        background: '#ffffff',
        lineColor: '#19241d',
      });
    } catch (error) {
      console.error('Could not render library card barcode.', error);
    }
  }, [cardNumber]);

  if (!selectedUser) {
    return (
      <div className="page-stack">
        <PageIntro
          eyebrow="LIBRARY CARD"
          title="利用証"
          subtitle="図書館で提示する利用証です。"
          icon={<ScanBarcode size={22} />}
        />
        <EmptyPanel
          icon={<ScanBarcode size={24} />}
          title="利用者情報がありません"
          text="利用状況データを読み込んでください。"
        />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageIntro
        eyebrow="LIBRARY CARD"
        title="利用証"
        subtitle="カウンターでこのバーコードをご提示ください。"
        icon={<ScanBarcode size={22} />}
      />
      <div className="barcode-layout">
        <section className="barcode-card">
          <div className="library-card-top">
            <span className="library-emblem">
              <LibraryBig size={21} />
            </span>
            <span>
              <strong>市立図書館</strong>
              <small>LIBRARY MEMBERSHIP</small>
            </span>
            <span className="card-chip">利用証</span>
          </div>
          <div className="member-tabs" role="tablist" aria-label="利用者を選択">
            {users.map((user, index) => (
              <button
                key={user.userId}
                className={`member-tab ${selectedUser.userId === user.userId ? 'selected' : ''}`}
                role="tab"
                aria-selected={selectedUser.userId === user.userId}
                onClick={() => setSelectedUserId(user.userId)}
              >
                <span className={`avatar avatar-${index % 4}`}>
                  {user.name.slice(0, 1)}
                </span>
                {user.name}
              </button>
            ))}
          </div>
          <div className="library-card-body">
            <div className="member-info">
              <span className="member-label">CARD HOLDER</span>
              <h2>
                {selectedUser.name}
                <small> さん</small>
              </h2>
              <span className="member-number-label">利用者番号</span>
              <strong className="member-number">
                {cardNumber || '利用者番号は登録されていません'}
              </strong>
            </div>
            <div className="barcode-wrap">
              {cardNumber ? (
                <>
                  <svg
                    id="library-barcode"
                    aria-label={`${selectedUser.name}さんの図書館バーコード`}
                  />
                  <span>{cardNumber}</span>
                </>
              ) : (
                <div className="barcode-empty">
                  <CircleAlert size={20} />
                  <span>
                    カード番号が
                    <br />
                    データにありません
                  </span>
                </div>
              )}
            </div>
          </div>
          <div className="library-card-foot">
            <span>この利用証をカウンターでご提示ください</span>
            <span className="card-sparkle">✳</span>
          </div>
        </section>
        <aside className="barcode-tip">
          <div className="tip-icon">
            <Sparkles size={20} />
          </div>
          <h3>読み取りのヒント</h3>
          <ul>
            <li>画面の明るさを上げてください</li>
            <li>バーコード全体を読み取り機に向けてください</li>
            <li>画面の自動ロックを一時的にオフにすると便利です</li>
          </ul>
          <p>※ この画面を開いたままカウンターでご提示ください。</p>
        </aside>
      </div>
    </div>
  );
}

function PageIntro({
  eyebrow,
  title,
  subtitle,
  icon,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}) {
  return (
    <section className="page-intro">
      <div className="page-intro-icon">{icon}</div>
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="welcome-subtitle">{subtitle}</p>
      </div>
    </section>
  );
}

function UserFilter({
  users,
  selected,
  onChange,
}: {
  users: LibraryUser[];
  selected: string;
  onChange: (userId: string) => void;
}) {
  return (
    <label className="filter-select">
      <span className="sr-only">利用者で絞り込む</span>
      <select
        value={selected}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="all">家族全員</option>
        {users.map((user) => (
          <option value={user.userId} key={user.userId}>
            {user.name}
          </option>
        ))}
      </select>
      <ChevronDown size={16} />
    </label>
  );
}

function UserBadge({ name }: { name: string }) {
  return (
    <span className="user-badge">
      <span className="avatar avatar-tiny">{name.slice(0, 1)}</span>
      {name}
    </span>
  );
}

function EmptyMessage({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="empty-message">
      <span className="empty-icon">{icon}</span>
      <span>
        <strong>{title}</strong>
        <small>{text}</small>
      </span>
    </div>
  );
}

function EmptyPanel({
  icon,
  title,
  text,
  action,
  onAction,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <section className="empty-panel">
      <span className="empty-panel-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && onAction && (
        <button className="button-secondary" onClick={onAction}>
          {action} <ArrowRight size={15} />
        </button>
      )}
    </section>
  );
}

function LoginScreen({
  error,
  onLogin,
}: {
  error: string;
  onLogin: () => void;
}) {
  const configured = Boolean(authConfiguration);
  return (
    <main className="login-screen">
      <div className="login-art" aria-hidden="true">
        <div className="art-sun" />
        <div className="art-book art-book-one" />
        <div className="art-book art-book-two" />
        <div className="art-book art-book-three" />
        <span className="art-star star-one">✳</span>
        <span className="art-star star-two">✦</span>
      </div>
      <section className="login-card">
        <Brand />
        <p className="eyebrow login-eyebrow">YOUR LITTLE LIBRARY</p>
        <h1>
          家族の読書時間を、
          <br />
          ひとつの場所に。
        </h1>
        <p className="login-copy">
          貸出中の本も、予約の順番も。
          <br />
          家族みんなの図書館を、いつでもチェック。
        </p>
        {error && (
          <div className="login-error" role="alert">
            <CircleAlert size={17} />
            {error}
          </div>
        )}
        <button
          className="login-button"
          onClick={onLogin}
          disabled={!configured}
        >
          {configured ? 'ログインしてはじめる' : 'ログイン設定が必要です'}
          <ArrowRight size={17} />
        </button>
        {!configured && (
          <p className="config-hint">
            VITE_COGNITO_DOMAIN と VITE_COGNITO_CLIENT_ID を設定してください。
          </p>
        )}
        <p className="login-foot">
          <ShieldCheck size={15} /> 家族だけが見られる、安全な記録です。
        </p>
      </section>
      <p className="login-credit">READ TOGETHER, EVERY DAY.</p>
    </main>
  );
}

function LoadingScreen({
  label,
  inline = false,
}: {
  label: string;
  inline?: boolean;
}) {
  return (
    <div className={inline ? 'inline-loading' : 'loading-screen'}>
      <LoaderCircle size={25} className="spin" />
      <span>{label}</span>
    </div>
  );
}

function readRoute(): Route {
  const pathname = window.location.pathname;
  return navigation.some((item) => item.route === pathname)
    ? (pathname as Route)
    : '/';
}

function daysUntil(date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(target)) return Number.MAX_SAFE_INTEGER;
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((target - today) / 86_400_000);
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function formatToday(): string {
  return new Intl.DateTimeFormat('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date());
}

function coverClass(title: string): string {
  const styles = ['cover-green', 'cover-peach', 'cover-lavender', 'cover-blue'];
  return styles[title.length % styles.length];
}

function safeCoverUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : '予期しないエラーが発生しました。';
}
