export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface PushNotice {
  type: string;
  title: string;
  message: string;
  bookTitle: string;
  date: string;
}

export interface PushSender {
  send(userId: string, notice: PushNotice): Promise<void>;
}

export interface StoredPushSubscription extends PushSubscription {
  id: string;
  userId: string;
  deviceId: string;
  updatedAt: string;
}

export interface SubscriptionStore {
  save(
    userId: string,
    deviceId: string,
    subscription: PushSubscription,
    updatedAt: string,
  ): Promise<void>;
  delete(userId: string, deviceId: string): Promise<void>;
}

export interface FunctionUrlEvent {
  rawPath?: string;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
  headers?: Record<string, string | undefined>;
  body?: string | null;
  isBase64Encoded?: boolean;
}

export interface FunctionUrlResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}
