import { useEffect, useRef, useState } from 'react';
import { Download, Plus, Share2, X } from 'lucide-react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
  }
}

type PromptState = 'waiting' | 'available' | 'guidance' | 'hidden';

export function PwaInstallPrompt() {
  const [promptState, setPromptState] = useState<PromptState>('waiting');
  const [isInstalling, setIsInstalling] = useState(false);
  const [installError, setInstallError] = useState('');
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);
  const dismissed = useRef(false);
  const dialogAction = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ('standalone' in navigator &&
        (navigator as Navigator & { standalone?: boolean }).standalone ===
          true);
    if (isStandalone) {
      setPromptState('hidden');
      return;
    }

    const onBeforeInstallPrompt = (event: BeforeInstallPromptEvent) => {
      event.preventDefault();
      deferredPrompt.current = event;
      if (!dismissed.current) setPromptState('available');
    };
    const onAppInstalled = () => {
      deferredPrompt.current = null;
      setPromptState('hidden');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    const fallbackTimer = window.setTimeout(() => {
      setPromptState((current) =>
        current === 'waiting' && !dismissed.current ? 'guidance' : current,
      );
    }, 1000);

    return () => {
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (promptState === 'hidden') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        dismissed.current = true;
        setPromptState('hidden');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [promptState]);

  useEffect(() => {
    if (promptState !== 'waiting' && promptState !== 'hidden') {
      dialogAction.current?.focus();
    }
  }, [promptState]);

  async function installApp() {
    const prompt = deferredPrompt.current;
    if (!prompt) return;

    deferredPrompt.current = null;
    setIsInstalling(true);
    setInstallError('');
    try {
      await prompt.prompt();
      await prompt.userChoice;
      setPromptState('hidden');
    } catch (error) {
      setInstallError(
        error instanceof Error
          ? error.message
          : 'アプリをインストールできませんでした。',
      );
      setPromptState('guidance');
    } finally {
      setIsInstalling(false);
    }
  }

  function dismissPrompt() {
    dismissed.current = true;
    setPromptState('hidden');
  }

  if (promptState === 'waiting' || promptState === 'hidden') return null;

  const isAppleMobile =
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  return (
    <div
      className="install-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) dismissPrompt();
      }}
    >
      <section
        className="install-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="install-title"
        aria-describedby="install-description"
      >
        <button
          className="install-close"
          type="button"
          onClick={dismissPrompt}
          aria-label="閉じる"
        >
          <X size={20} />
        </button>
        <div className="install-icon" aria-hidden="true">
          <Download size={25} />
        </div>
        <p className="eyebrow install-eyebrow">LIBRARY DASHBOARD</p>
        <h2 id="install-title">アプリをインストール</h2>
        <p id="install-description" className="install-description">
          ホーム画面に追加して、図書館ダッシュボードをアプリのようにすぐ開けます。
        </p>

        {promptState === 'available' ? (
          <button
            ref={dialogAction}
            className="install-action"
            type="button"
            onClick={() => void installApp()}
            disabled={isInstalling}
          >
            <Download size={18} />
            {isInstalling ? 'インストールしています…' : 'インストール'}
          </button>
        ) : (
          <div className="install-guidance">
            {isAppleMobile ? (
              <p>
                <Share2 size={18} aria-hidden="true" />
                <span>
                  ブラウザーの <strong>共有</strong> メニューから
                  <strong>「ホーム画面に追加」</strong>を選んでください。
                </span>
              </p>
            ) : (
              <p>
                <Plus size={18} aria-hidden="true" />
                <span>
                  ブラウザーのメニューから
                  <strong>「アプリをインストール」</strong>
                  または<strong>「ホーム画面に追加」</strong>
                  を選んでください。
                </span>
              </p>
            )}
          </div>
        )}

        {installError && (
          <p className="install-error" role="alert">
            {installError}
          </p>
        )}

        <button
          ref={promptState === 'guidance' ? dialogAction : undefined}
          className="install-dismiss"
          type="button"
          onClick={dismissPrompt}
        >
          あとで
        </button>
      </section>
    </div>
  );
}
