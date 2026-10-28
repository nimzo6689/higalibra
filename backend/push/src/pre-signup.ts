import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export interface PreSignUpEvent {
  request?: {
    userAttributes?: Record<string, string | undefined>;
  };
  [key: string]: unknown;
}

export type AllowedEmailLoader = () => Promise<ReadonlySet<string>>;

export function createPreSignUpHandler(loadAllowedEmails: AllowedEmailLoader) {
  return async function handlePreSignUp(
    event: PreSignUpEvent,
  ): Promise<PreSignUpEvent> {
    const email = event.request?.userAttributes?.email?.trim().toLowerCase();
    if (!email || !(await loadAllowedEmails()).has(email)) {
      throw new Error('Email address is not allowed.');
    }
    return event;
  };
}

let configuredHandler: ReturnType<typeof createPreSignUpHandler> | undefined;

export async function preSignUpHandler(
  event: PreSignUpEvent,
): Promise<PreSignUpEvent> {
  configuredHandler ??= createPreSignUpHandler(loadAllowedEmails);
  return configuredHandler(event);
}

async function loadAllowedEmails(): Promise<ReadonlySet<string>> {
  const parameterName = process.env.ALLOWED_EMAILS_PARAMETER_NAME?.trim();
  if (!parameterName) {
    throw new Error(
      'Missing required environment variable: ALLOWED_EMAILS_PARAMETER_NAME.',
    );
  }

  const response = await new SSMClient({ region: process.env.AWS_REGION }).send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );
  const value = response.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${parameterName} has no value.`);
  }

  let emails: unknown;
  try {
    emails = JSON.parse(value);
  } catch {
    throw new Error(
      `SSM parameter ${parameterName} must contain a JSON array of email addresses.`,
    );
  }
  if (
    !Array.isArray(emails) ||
    emails.length === 0 ||
    emails.some((email) => typeof email !== 'string' || !email.trim())
  ) {
    throw new Error(
      `SSM parameter ${parameterName} must contain a non-empty JSON array of email addresses.`,
    );
  }

  return new Set(emails.map((email: string) => email.trim().toLowerCase()));
}
