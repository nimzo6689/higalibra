import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CircleAlert,
  LogOut,
  Menu,
  RefreshCw,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  executeKeeper,
  fetchReservationSettings,
  fetchUserStatus,
  updateReservationSettings,
} from './api';
import {
  beginLogin,
  completeLogin,
  getAuthConfiguration,
  readSession,
  refreshSession,
  signOut,
  type AuthSession,
} from './auth';
import {
  disablePush,
  enablePush,
  hasPushSubscription,
  registerExistingPushSubscription,
} from './push';
import { BarcodePage } from './pages/BarcodePage';
import { BorrowedPage } from './pages/BorrowedPage';
import { HomePage } from './pages/HomePage';
import { ReservationsPage } from './pages/ReservationsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Brand, LoadingScreen, LoginScreen, Navigation } from './components';
import { daysUntil, errorMessage, formatDateTime, readRoute } from './utils';
import type { ReservationSettings, Route, UserStatusSnapshot } from './types';

const authConfiguration = getAuthConfiguration();

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authError, setAuthError] = useState('');
  const [snapshot, setSnapshot] = useState<UserStatusSnapshot | null>(null);
  const [dataError, setDataError] = useState('');
  const [syncError, setSyncError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isKeeperRunning, setIsKeeperRunning] = useState(false);
  const [route, setRoute] = useState<Route>(readRoute());
  const [reservationSettings, setReservationSettings] =
    useState<ReservationSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState('');
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsReloadKey, setSettingsReloadKey] = useState(0);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushError, setPushError] = useState('');
  const [pushMessage, setPushMessage] = useState('');
  const statusRequest = useRef<AbortController | null>(null);

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
        const storedSession = callbackSession ?? readSession();
        const session =
          storedSession &&
          storedSession.expiresAt <= Date.now() &&
          authConfiguration
            ? await refreshSession(authConfiguration, storedSession)
            : storedSession;
        if (active) setSession(session);
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

  const refreshStatus = useCallback(() => {
    statusRequest.current?.abort();
    statusRequest.current = null;
    if (!session) {
      setIsLoading(false);
      setDataError('利用状況の接続設定がありません。');
      return;
    }

    const statusUrl = import.meta.env.VITE_STATUS_URL?.trim();
    if (!statusUrl) {
      setDataError('VITE_STATUS_URL が設定されていません。');
      setIsLoading(false);
      return;
    }

    const controller = new AbortController();
    statusRequest.current = controller;
    setIsLoading(true);
    setDataError('');
    fetchUserStatus(
      statusUrl,
      session.idToken,
      authConfiguration,
      setSession,
      controller.signal,
    )
      .then((nextSnapshot) => {
        if (!controller.signal.aborted) setSnapshot(nextSnapshot);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setDataError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          statusRequest.current = null;
          setIsLoading(false);
        }
      });
  }, [session]);

  const syncStatus = useCallback(async () => {
    if (!session) return;
    const apiUrl = import.meta.env.VITE_KEEPER_API_URL?.trim();
    if (!apiUrl) {
      setSyncError('VITE_KEEPER_API_URL が設定されていません。');
      return;
    }

    statusRequest.current?.abort();
    statusRequest.current = null;
    setIsLoading(true);
    setIsKeeperRunning(true);
    setSyncError('');
    setDataError('');
    try {
      await executeKeeper(
        apiUrl,
        session.idToken,
        authConfiguration,
        setSession,
      );
    } catch (error) {
      setSyncError(errorMessage(error));
    } finally {
      setIsKeeperRunning(false);
    }
    refreshStatus();
  }, [session, refreshStatus]);

  useEffect(() => {
    if (!session) {
      setReservationSettings(null);
      return;
    }

    const apiUrl = import.meta.env.VITE_RESERVATION_SETTINGS_API_URL?.trim();
    if (!apiUrl) {
      setSettingsError('予約設定 API の接続設定がありません。');
      setSettingsLoading(false);
      return;
    }

    let active = true;
    setSettingsLoading(true);
    setSettingsError('');
    fetchReservationSettings(
      apiUrl,
      session.idToken,
      authConfiguration,
      setSession,
    )
      .then((settings) => {
        if (active) setReservationSettings(settings);
      })
      .catch((error: unknown) => {
        if (active) setSettingsError(errorMessage(error));
      })
      .finally(() => {
        if (active) setSettingsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session, settingsReloadKey]);

  useEffect(() => {
    if (!session || !authConfiguration) return;

    let timeout: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        setSession(await refreshSession(authConfiguration, session));
        setAuthError('');
      } catch (error) {
        setAuthError(errorMessage(error));
        const remaining = session.expiresAt - Date.now();
        if (remaining <= 0) {
          setSession(null);
          return;
        }
        timeout = setTimeout(refresh, Math.min(30_000, remaining));
      }
    };
    timeout = setTimeout(
      refresh,
      Math.max(0, session.expiresAt - Date.now() - 60_000),
    );

    return () => clearTimeout(timeout);
  }, [session]);

  useEffect(() => {
    if (!session) {
      setSnapshot(null);
      return;
    }

    void refreshStatus();
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void refreshStatus();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    window.addEventListener('focus', refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
      window.removeEventListener('focus', refreshWhenVisible);
      statusRequest.current?.abort();
      statusRequest.current = null;
    };
  }, [session, refreshStatus]);

  useEffect(() => {
    function onPopState() {
      setRoute(readRoute());
      setIsDrawerOpen(false);
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!isDrawerOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDrawerOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isDrawerOpen]);

  useEffect(() => {
    const currentSession = session;
    if (!currentSession?.idToken || !('serviceWorker' in navigator)) return;
    const idToken = currentSession.idToken;
    let active = true;
    async function synchronizePushSubscription() {
      const subscriptionExists = await hasPushSubscription();
      if (!active) return;
      if (!subscriptionExists) {
        setPushEnabled(false);
        return;
      }

      const apiUrl = import.meta.env.VITE_PUSH_API_URL?.trim();
      if (!apiUrl) {
        throw new Error('通知 API の設定がありません。');
      }

      setPushBusy(true);
      try {
        const registered = await registerExistingPushSubscription(
          apiUrl,
          idToken,
          authConfiguration,
          setSession,
        );
        if (active) {
          setPushEnabled(registered);
          setPushError('');
        }
      } finally {
        if (active) setPushBusy(false);
      }
    }

    void synchronizePushSubscription().catch((error: unknown) => {
      if (!active) return;
      setPushEnabled(false);
      setPushError(errorMessage(error));
    });
    return () => {
      active = false;
    };
  }, [session]);

  const changeRoute = useCallback((nextRoute: Route) => {
    if (window.location.pathname !== nextRoute) {
      window.history.pushState({}, '', nextRoute);
    }
    setRoute(nextRoute);
    setIsDrawerOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  async function saveReservationSettings() {
    if (!session || !reservationSettings) return;
    const apiUrl = import.meta.env.VITE_RESERVATION_SETTINGS_API_URL?.trim();
    if (!apiUrl) {
      setSettingsError('予約設定 API の接続設定がありません。');
      return;
    }
    setSettingsSaving(true);
    setSettingsError('');
    setSettingsMessage('');
    try {
      const cleanSettings: ReservationSettings = {
        publishers: cleanCriterion(reservationSettings.publishers),
        authors: cleanCriterion(reservationSettings.authors),
        titleKeywords: cleanCriterion(reservationSettings.titleKeywords),
      };
      setReservationSettings(
        await updateReservationSettings(
          apiUrl,
          session.idToken,
          authConfiguration,
          setSession,
          cleanSettings,
        ),
      );
      setSettingsMessage('予約設定を保存しました。');
    } catch (error) {
      setSettingsError(errorMessage(error));
    } finally {
      setSettingsSaving(false);
    }
  }

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
        await disablePush(
          apiUrl,
          session.idToken,
          authConfiguration,
          setSession,
        );
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
        await enablePush(
          apiUrl,
          session.idToken,
          authConfiguration,
          setSession,
          vapidPublicKey,
        );
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
        configured={Boolean(authConfiguration)}
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

  function cleanCriterion(
    criterion: ReservationSettings['publishers'],
  ): ReservationSettings['publishers'] {
    const values = criterion.values
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
    if (values.length > 20 || values.some((value) => value.length > 100)) {
      throw new Error('各項目は20個まで、各値は100文字まで入力できます。');
    }
    return { operator: criterion.operator, values };
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
              ログインした利用者だけの
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
            <span className="avatar avatar-small">図</span>
            <span className="profile-copy">
              <strong>利用者アカウント</strong>
              <small>ログアウト</small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>

      {isDrawerOpen && (
        <div className="mobile-drawer-layer">
          <button
            type="button"
            className="mobile-drawer-backdrop"
            aria-label="メニューを閉じる"
            onClick={() => setIsDrawerOpen(false)}
          />
          <aside
            className="mobile-drawer"
            id="mobile-navigation"
            aria-label="メニュー"
            aria-modal="true"
            role="dialog"
          >
            <div className="mobile-drawer-heading">
              <Brand />
              <button
                type="button"
                className="icon-button"
                aria-label="メニューを閉じる"
                onClick={() => setIsDrawerOpen(false)}
              >
                <X size={19} />
              </button>
            </div>
            <Navigation route={route} onNavigate={changeRoute} />
          </aside>
        </div>
      )}

      <div className="main-column">
        <header className="topbar">
          <div className="mobile-brand">
            <button
              type="button"
              className="mobile-menu-button"
              aria-label="メニューを開く"
              aria-expanded={isDrawerOpen}
              aria-controls="mobile-navigation"
              onClick={() => setIsDrawerOpen(true)}
            >
              <Menu size={20} />
            </button>
            <Brand />
          </div>
          <div className="topbar-right">
            <span className="sync-status">
              <span className={`sync-dot ${snapshot ? 'is-online' : ''}`} />
              {snapshot ? '同期済み' : '未同期'}
            </span>
            <button
              className="icon-button"
              onClick={() => void syncStatus()}
              aria-label="利用状況を更新"
              title="利用状況を更新"
              disabled={isLoading || isKeeperRunning}
            >
              <RefreshCw
                className={isLoading || isKeeperRunning ? 'spin' : ''}
                size={18}
              />
            </button>
          </div>
        </header>

        <main className="page-content">
          {(dataError || syncError) && (
            <div className="notice notice-error" role="alert">
              <CircleAlert size={19} />
              <div>
                <strong>
                  {syncError
                    ? 'Keeper の実行に失敗しました'
                    : 'データを読み込めません'}
                </strong>
                <p>{[syncError, dataError].filter(Boolean).join(' ')}</p>
              </div>
              <button
                onClick={syncError ? () => void syncStatus() : refreshStatus}
                className="notice-action"
              >
                再試行
              </button>
            </div>
          )}

          {route === '/settings' ? (
            <SettingsPage
              settings={reservationSettings}
              isLoading={settingsLoading}
              isSaving={settingsSaving}
              error={settingsError}
              message={settingsMessage}
              onRetry={() => setSettingsReloadKey((key) => key + 1)}
              onChange={(settings) => {
                setReservationSettings(settings);
                setSettingsError('');
                setSettingsMessage('');
              }}
              onSave={() => void saveReservationSettings()}
            />
          ) : isLoading && !snapshot ? (
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
              {route === '/barcode' && (
                <BarcodePage
                  users={users}
                  lastUpdated={snapshot?.lastUpdated}
                />
              )}
            </>
          )}
        </main>

        <footer className="page-footer">
          <span>図書館ダッシュボード</span>
          {snapshot?.lastUpdated && (
            <span>最終更新 {formatDateTime(snapshot.lastUpdated)}</span>
          )}
        </footer>
      </div>

      <div className="mobile-nav-wrap">
        <Navigation route={route} onNavigate={changeRoute} hideSettings />
      </div>
    </div>
  );
}
