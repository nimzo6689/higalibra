export interface KeeperApiEvent {
  rawPath?: string;
  headers?: Record<string, string | undefined>;
  requestContext?: {
    http?: {
      method?: string;
      path?: string;
    };
  };
}

export interface KeeperApiResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function createKeeperApiHandler(dependencies: {
  runKeeper(): Promise<unknown>;
}) {
  return async function handle(
    event: KeeperApiEvent,
  ): Promise<KeeperApiResponse> {
    const method = (event.requestContext?.http?.method ?? '').toUpperCase();
    const path = event.rawPath ?? event.requestContext?.http?.path ?? '';
    if (path !== '/keeper') {
      return response(404);
    }
    if (method !== 'POST') {
      return response(405, { allow: 'POST' });
    }
    if (!readAuthenticatedEmail(event.headers ?? {})) {
      return response(401);
    }

    try {
      await dependencies.runKeeper();
      return response(200);
    } catch (error) {
      console.error('Keeper API execution failed.', error);
      return response(500);
    }
  };
}

function readAuthenticatedEmail(
  headers: Record<string, string | undefined>,
): string | null {
  const email = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === 'x-authenticated-email',
  )?.[1];
  return email?.trim() || null;
}

function response(
  statusCode: number,
  additionalHeaders: Record<string, string> = {},
): KeeperApiResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...additionalHeaders,
    },
    body: JSON.stringify({ success: statusCode === 200 }),
  };
}
