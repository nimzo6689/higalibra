import { loadEmailCardNumbers, normalizeEmail } from './email-card-numbers.js';

export interface PreSignUpEvent {
  request?: {
    userAttributes?: Record<string, string | undefined>;
  };
  [key: string]: unknown;
}

export type EmailCardNumberLoader = () => Promise<ReadonlyMap<string, string>>;

export function createPreSignUpHandler(
  loadEmailCardNumberMap: EmailCardNumberLoader,
) {
  return async function handlePreSignUp(
    event: PreSignUpEvent,
  ): Promise<PreSignUpEvent> {
    const email = event.request?.userAttributes?.email;
    if (
      !email ||
      !(await loadEmailCardNumberMap()).has(normalizeEmail(email))
    ) {
      throw new Error('Email address is not allowed.');
    }
    return event;
  };
}

let configuredHandler: ReturnType<typeof createPreSignUpHandler> | undefined;

export async function preSignUpHandler(
  event: PreSignUpEvent,
): Promise<PreSignUpEvent> {
  configuredHandler ??= createPreSignUpHandler(loadConfiguredEmailCardNumbers);
  return configuredHandler(event);
}

async function loadConfiguredEmailCardNumbers(): Promise<
  ReadonlyMap<string, string>
> {
  const parameterName = process.env.ALLOWED_EMAILS_PARAMETER_NAME?.trim();
  if (!parameterName) {
    throw new Error(
      'Missing required environment variable: ALLOWED_EMAILS_PARAMETER_NAME.',
    );
  }

  return loadEmailCardNumbers(parameterName);
}
