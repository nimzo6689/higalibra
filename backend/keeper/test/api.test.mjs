import assert from 'node:assert/strict';
import test from 'node:test';
import { createKeeperApiHandler } from '../src/api.ts';

function event({
  path = '/keeper',
  method = 'POST',
  headers = { 'x-authenticated-email': 'member@example.com' },
} = {}) {
  return {
    rawPath: path,
    headers,
    requestContext: { http: { method, path } },
  };
}

test('runs Keeper for an authenticated POST and returns only success status', async () => {
  let executions = 0;
  const handler = createKeeperApiHandler({
    async runKeeper() {
      executions += 1;
      return { userCount: 4, extendedBookCount: 2 };
    },
  });

  const result = await handler(event());

  assert.equal(executions, 1);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(JSON.parse(result.body), { success: true });
});

test('rejects missing identity, unsupported methods, and unknown paths', async () => {
  let executions = 0;
  const handler = createKeeperApiHandler({
    async runKeeper() {
      executions += 1;
    },
  });

  const unauthenticated = await handler(event({ headers: {} }));
  const unsupportedMethod = await handler(event({ method: 'GET' }));
  const unknownPath = await handler(event({ path: '/other' }));

  assert.equal(unauthenticated.statusCode, 401);
  assert.equal(unsupportedMethod.statusCode, 405);
  assert.equal(unknownPath.statusCode, 404);
  assert.deepEqual(JSON.parse(unauthenticated.body), { success: false });
  assert.equal(executions, 0);
});

test('returns a failure status when Keeper fails', async () => {
  const handler = createKeeperApiHandler({
    async runKeeper() {
      throw new Error('library unavailable');
    },
  });
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await handler(event());
    assert.equal(result.statusCode, 500);
    assert.deepEqual(JSON.parse(result.body), { success: false });
  } finally {
    console.error = originalError;
  }
});
