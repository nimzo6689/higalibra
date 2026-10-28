const DEVICE_ID_STORAGE_KEY = 'mesh.push-device-id';

export async function enablePush(
  apiUrl: string,
  idToken: string,
  vapidPublicKey: string,
): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    throw new Error('このブラウザーは Web Push 通知に対応していません。');
  }
  const registration = await navigator.serviceWorker.ready;
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(vapidPublicKey),
    }));
  const response = await fetch(new URL('/subscriptions', apiUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      deviceId: getDeviceId(),
      subscription: subscription.toJSON(),
    }),
  });
  if (!response.ok) {
    throw new Error(`通知の登録に失敗しました (HTTP ${response.status})。`);
  }
}

export async function disablePush(
  apiUrl: string,
  idToken: string,
): Promise<void> {
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;

  const response = await fetch(new URL('/subscriptions', apiUrl), {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${idToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ deviceId: getDeviceId() }),
  });
  if (!response.ok) {
    throw new Error(`通知の解除に失敗しました (HTTP ${response.status})。`);
  }
  await subscription.unsubscribe();
}

export async function hasPushSubscription(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return false;
  }
  const registration = await navigator.serviceWorker.ready;
  return (await registration.pushManager.getSubscription()) !== null;
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
