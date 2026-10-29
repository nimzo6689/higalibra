import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

export async function loadEmailCardNumbers(
  parameterName: string,
): Promise<ReadonlyMap<string, string>> {
  const response = await ssmClient.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );
  const value = response.Parameter?.Value;
  if (!value) {
    throw new Error(`SSM parameter ${parameterName} has no value.`);
  }

  let mapping: unknown;
  try {
    mapping = JSON.parse(value);
  } catch {
    throw new Error(
      `SSM parameter ${parameterName} must contain a JSON object mapping email addresses to card numbers.`,
    );
  }
  if (
    typeof mapping !== 'object' ||
    mapping === null ||
    Array.isArray(mapping) ||
    Object.keys(mapping).length === 0
  ) {
    throw new Error(
      `SSM parameter ${parameterName} must contain a non-empty JSON object mapping email addresses to card numbers.`,
    );
  }

  const emailCardNumbers = new Map<string, string>();
  for (const [email, cardNo] of Object.entries(mapping)) {
    const normalizedEmail = email.trim().toLowerCase();
    if (
      !normalizedEmail ||
      typeof cardNo !== 'string' ||
      !cardNo.trim() ||
      emailCardNumbers.has(normalizedEmail)
    ) {
      throw new Error(
        `SSM parameter ${parameterName} must map unique email addresses to non-empty card numbers.`,
      );
    }
    emailCardNumbers.set(normalizedEmail, cardNo.trim());
  }

  return emailCardNumbers;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
