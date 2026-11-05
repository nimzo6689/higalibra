import { fetchWithTokenRefresh } from './auth';
import type { AuthConfiguration, AuthSession } from './auth';

const DEVICE_ID_STORAGE_KEY = 'mesh.push-device-id';

export async function enablePush(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
  vapidPublicKey: string,
): Promise<void> {
  if (!('PushManager' in window)) {
    throw new Error('このブラウザーは Web Push 通知に対応していません。');
  }
  const registration = await getPushRegistration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(vapidPublicKey),
    }));
  await saveSubscription(
    apiUrl,
    idToken,
    configuration,
    onSessionRefresh,
    subscription,
  );
}

export async function registerExistingPushSubscription(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  const registration = await getPushRegistration();
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return false;

  await saveSubscription(
    apiUrl,
    idToken,
    configuration,
    onSessionRefresh,
    subscription,
  );
  return true;
}

async function saveSubscription(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
  subscription: PushSubscription,
): Promise<void> {
  const deviceId = getDeviceId();
  const body = JSON.stringify({
    deviceId,
    subscription: subscription.toJSON(),
  });
  const response = await fetchWithTokenRefresh(
    new URL('/subscriptions', apiUrl),
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${idToken}`,
        'x-amz-content-sha256': await sha256Hex(body),
        'content-type': 'application/json',
      },
      body,
    },
    configuration,
    idToken,
    onSessionRefresh,
  );
  if (!response.ok) {
    throw new Error(`通知の登録に失敗しました (HTTP ${response.status})。`);
  }
  const result = await readApiResponse(response);
  if (result.deviceId !== deviceId || typeof result.updatedAt !== 'string') {
    throw new Error('通知 API から想定外の登録結果が返されました。');
  }
}

export async function disablePush(
  apiUrl: string,
  idToken: string,
  configuration: AuthConfiguration | null,
  onSessionRefresh: (session: AuthSession) => void,
): Promise<void> {
  const deviceId = getDeviceId();
  const response = await fetchWithTokenRefresh(
    new URL(`/subscriptions/${encodeURIComponent(deviceId)}`, apiUrl),
    {
      method: 'DELETE',
      headers: {
        authorization: `Bearer ${idToken}`,
      },
    },
    configuration,
    idToken,
    onSessionRefresh,
  );
  if (!response.ok) {
    throw new Error(`通知の解除に失敗しました (HTTP ${response.status})。`);
  }
  const result = await readApiResponse(response);
  if (result.deleted !== true) {
    throw new Error('通知 API から想定外の解除結果が返されました。');
  }
  if ('serviceWorker' in navigator && 'PushManager' in window) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
}

export async function hasPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  const registration = await getPushRegistration();
  return (await registration.pushManager.getSubscription()) !== null;
}

async function getPushRegistration(): Promise<ServiceWorkerRegistration> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('このブラウザーは Service Worker に対応していません。');
  }
  return navigator.serviceWorker.register('/sw.js');
}

async function readApiResponse(
  response: Response,
): Promise<Record<string, unknown>> {
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(
      `通知 API から JSON 以外の応答が返されました (HTTP ${response.status}, ${contentType || 'content-type なし'})。`,
    );
  }
  const value: unknown = await response.json();
  if (!isRecord(value)) {
    throw new Error('通知 API から想定外の応答が返されました。');
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function decodeVapidKey(key: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (key.length % 4)) % 4);
  const base64 = (key + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function getDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  if (existing) return existing;
  const deviceId = crypto.randomUUID();
  localStorage.setItem(DEVICE_ID_STORAGE_KEY, deviceId);
  return deviceId;
}
