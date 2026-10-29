import assert from 'node:assert/strict';
import test from 'node:test';
import { createPreSignUpHandler } from '../dist/index.js';

test('allows an email from the configured list regardless of letter case', async () => {
  const event = {
    triggerSource: 'PreSignUp_ExternalProvider',
    request: { userAttributes: { email: 'Member@Example.com' } },
  };
  const handler = createPreSignUpHandler(
    async () => new Map([['member@example.com', '2010610570']]),
  );

  assert.equal(await handler(event), event);
});

test('rejects email addresses outside the configured list', async () => {
  const handler = createPreSignUpHandler(
    async () => new Map([['member@example.com', '2010610570']]),
  );

  await assert.rejects(
    handler({ request: { userAttributes: { email: 'other@example.com' } } }),
    /Email address is not allowed/,
  );
});

test('rejects events without an email address', async () => {
  const handler = createPreSignUpHandler(async () => new Map());

  await assert.rejects(
    handler({ request: { userAttributes: {} } }),
    /Email address is not allowed/,
  );
});
