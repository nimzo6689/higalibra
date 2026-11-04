import { ArrowRight, CircleAlert, ShieldCheck } from 'lucide-react';
import { Brand } from './Brand';

export function LoginScreen({
  error,
  onLogin,
  configured,
}: {
  error: string;
  onLogin: () => void;
  configured: boolean;
}) {
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
          {configured ? 'Google でログイン' : 'ログイン設定が必要です'}
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
