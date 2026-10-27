const TOKEN_STORAGE_KEY = 'mesh.id-token';
const STATE_STORAGE_KEY = 'mesh.oauth-state';
const VERIFIER_STORAGE_KEY = 'mesh.pkce-verifier';

export interface AuthConfiguration {
  domain: string;
  clientId: string;
  redirectUri: string;
}

export interface AuthSession {
  idToken: string;
  expiresAt: number;
}

export function getAuthConfiguration(): AuthConfiguration | null {
  const domain = import.meta.env.VITE_COGNITO_DOMAIN?.trim();
  const clientId = import.meta.env.VITE_COGNITO_CLIENT_ID?.trim();
  if (!domain || !clientId) return null;

  return {
    domain: domain.replace(/\/+$/, ''),
    clientId,
    redirectUri:
      import.meta.env.VITE_COGNITO_REDIRECT_URI?.trim() ||
      window.location.origin,
  };
}

export async function beginLogin(
  configuration: AuthConfiguration,
): Promise<void> {
  const state = createRandomValue(32);
  const verifier = createRandomValue(64);
  const challenge = await createCodeChallenge(verifier);
  sessionStorage.setItem(STATE_STORAGE_KEY, state);
  sessionStorage.setItem(VERIFIER_STORAGE_KEY, verifier);

  const url = new URL('/oauth2/authorize', configuration.domain);
  url.search = new URLSearchParams({
    client_id: configuration.clientId,
    response_type: 'code',
    scope: 'openid email profile',
    redirect_uri: configuration.redirectUri,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  window.location.assign(url);
}

export async function completeLogin(
  configuration: AuthConfiguration,
): Promise<AuthSession | null> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  if (!code) return null;
  window.history.replaceState({}, '', window.location.pathname);

  const returnedState = params.get('state');
  const expectedState = sessionStorage.getItem(STATE_STORAGE_KEY);
  const verifier = sessionStorage.getItem(VERIFIER_STORAGE_KEY);
  sessionStorage.removeItem(STATE_STORAGE_KEY);
  sessionStorage.removeItem(VERIFIER_STORAGE_KEY);
  if (!returnedState || returnedState !== expectedState || !verifier) {
    throw new Error(
      'ログイン状態を確認できませんでした。もう一度お試しください。',
    );
  }

  const response = await fetch(new URL('/oauth2/token', configuration.domain), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: configuration.clientId,
      code,
      redirect_uri: configuration.redirectUri,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    throw new Error(`ログインに失敗しました (HTTP ${response.status})。`);
  }

  const tokens: unknown = await response.json();
  if (
    typeof tokens !== 'object' ||
    tokens === null ||
    !('id_token' in tokens) ||
    typeof tokens.id_token !== 'string' ||
    !('expires_in' in tokens) ||
    typeof tokens.expires_in !== 'number'
  ) {
    throw new Error('認証サーバーから有効な ID トークンが返されませんでした。');
  }
  const session: AuthSession = {
    idToken: tokens.id_token,
    expiresAt: Date.now() + tokens.expires_in * 1000,
  };
  sessionStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export function readSession(): AuthSession | null {
  const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);
  if (!saved) return null;

  try {
    const value: unknown = JSON.parse(saved);
    if (
      typeof value === 'object' &&
      value !== null &&
      'idToken' in value &&
      typeof value.idToken === 'string' &&
      'expiresAt' in value &&
      typeof value.expiresAt === 'number' &&
      value.expiresAt > Date.now()
    ) {
      return { idToken: value.idToken, expiresAt: value.expiresAt };
    }
  } catch {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    return null;
  }

  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  return null;
}

export function signOut(configuration: AuthConfiguration): void {
  sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  const url = new URL('/logout', configuration.domain);
  url.search = new URLSearchParams({
    client_id: configuration.clientId,
    logout_uri: configuration.redirectUri,
  }).toString();
  window.location.assign(url);
}

function createRandomValue(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return toBase64Url(bytes);
}

async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(verifier),
  );
  return toBase64Url(new Uint8Array(digest));
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
