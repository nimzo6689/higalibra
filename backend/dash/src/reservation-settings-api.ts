import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  loadEmailCardNumbers,
  normalizeEmail,
  type FunctionUrlEvent,
  type FunctionUrlResponse,
} from '@higalibra/push';
import {
  EMPTY_RESERVATION_SETTINGS,
  parseReservationSettings,
  reservationSettingsObjectKey,
} from './settings.js';
import type { ReservationSettings } from './settings.js';

interface ReservationSettingsApiDependencies {
  loadEmailCardNumbers(): Promise<ReadonlyMap<string, string>>;
  loadSettings(cardNo: string): Promise<ReservationSettings>;
  saveSettings(cardNo: string, settings: ReservationSettings): Promise<void>;
}

interface ReservationSettingsApiConfiguration {
  bucket: string;
  prefix: string;
  allowedEmailsParameterName: string;
  region?: string;
}

export function createReservationSettingsHandler(
  dependencies: ReservationSettingsApiDependencies,
) {
  return async function handle(
    event: FunctionUrlEvent,
  ): Promise<FunctionUrlResponse> {
    const method = (event.requestContext?.http?.method ?? '').toUpperCase();
    const path = event.rawPath ?? event.requestContext?.http?.path ?? '';
    if (path !== '/reservation-settings') {
      return response(404, { error: 'Not found.' });
    }
    if (method !== 'GET' && method !== 'PUT') {
      return response(
        405,
        { error: 'Method not allowed.' },
        { allow: 'GET, PUT' },
      );
    }

    const email = readAuthenticatedEmail(event.headers ?? {});
    if (!email) {
      return response(401, { error: 'Authenticated identity is missing.' });
    }
    const cardNo = (await dependencies.loadEmailCardNumbers()).get(
      normalizeEmail(email),
    );
    if (!cardNo) {
      return response(403, { error: 'Email address is not authorized.' });
    }

    if (method === 'GET') {
      return response(200, {
        settings: await dependencies.loadSettings(cardNo),
      });
    }

    let body: unknown;
    try {
      body = parseBody(event);
    } catch {
      return response(400, { error: 'Request body must be valid JSON.' });
    }
    if (!isRecord(body) || !('settings' in body)) {
      return response(400, { error: 'Request body must contain settings.' });
    }
    let settings: ReservationSettings;
    try {
      settings = parseReservationSettings(body.settings);
    } catch (error) {
      return response(400, {
        error:
          error instanceof Error
            ? error.message
            : 'Reservation settings are invalid.',
      });
    }
    await dependencies.saveSettings(cardNo, settings);
    return response(200, { settings });
  };
}

export async function reservationSettingsApiHandler(
  event: FunctionUrlEvent,
): Promise<FunctionUrlResponse> {
  const configuration = readConfiguration();
  const client = new S3Client({ region: configuration.region });
  const prefix = configuration.prefix;
  return createReservationSettingsHandler({
    loadEmailCardNumbers: () =>
      loadEmailCardNumbers(configuration.allowedEmailsParameterName),
    async loadSettings(cardNo) {
      const key = reservationSettingsObjectKey(prefix, cardNo);
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: configuration.bucket, Key: key }),
        );
        if (!result.Body) {
          throw new Error(
            `Reservation settings s3://${configuration.bucket}/${key} has no body.`,
          );
        }
        return parseReservationSettings(
          JSON.parse(await result.Body.transformToString()) as unknown,
        );
      } catch (error) {
        if (isS3NotFound(error)) {
          return EMPTY_RESERVATION_SETTINGS;
        }
        throw error;
      }
    },
    async saveSettings(cardNo, settings) {
      await client.send(
        new PutObjectCommand({
          Bucket: configuration.bucket,
          Key: reservationSettingsObjectKey(prefix, cardNo),
          Body: JSON.stringify(settings),
          ContentType: 'application/json; charset=utf-8',
        }),
      );
    },
  })(event);
}

function readConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): ReservationSettingsApiConfiguration {
  return {
    bucket: requiredEnvironmentValue(environment, 'DASH_HISTORY_BUCKET'),
    prefix: environment.DASH_SETTINGS_PREFIX?.trim() || 'reservation-settings',
    allowedEmailsParameterName: requiredEnvironmentValue(
      environment,
      'ALLOWED_EMAILS_PARAMETER_NAME',
    ),
    region: environment.AWS_REGION,
  };
}

function requiredEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}.`);
  }
  return value;
}

function readAuthenticatedEmail(
  headers: Record<string, string | undefined>,
): string | null {
  const normalizedHeaders = new Map(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      value?.trim(),
    ]),
  );
  return normalizedHeaders.get('x-authenticated-email') || null;
}

function parseBody(event: FunctionUrlEvent): unknown {
  if (typeof event.body !== 'string') {
    throw new Error('Request body is missing.');
  }
  const text = event.isBase64Encoded
    ? Buffer.from(event.body, 'base64').toString('utf8')
    : event.body;
  return JSON.parse(text) as unknown;
}

function response(
  statusCode: number,
  payload: Record<string, unknown>,
  additionalHeaders: Record<string, string> = {},
): FunctionUrlResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...additionalHeaders,
    },
    body: JSON.stringify(payload),
  };
}

function isS3NotFound(error: unknown): boolean {
  return (
    isRecord(error) && (error.name === 'NoSuchKey' || error.name === 'NotFound')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
