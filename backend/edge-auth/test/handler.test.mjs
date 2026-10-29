import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { createEdgeAuthHandler } from '../handler.mjs';

const issuer =
  'https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_test';
const userId = 'family-member-sub';
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = {
  ...publicKey.export({ format: 'jwk' }),
  kid: 'test-key',
  kty: 'RSA',
};

function createToken(claimOverrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'RS256', kid: 'test-key' });
  const claims = encode({
    iss: issuer,
    token_use: 'id',
    aud: 'test-client',
    sub: userId,
    email: 'member@example.com',
    email_verified: true,
    iat: now,
    exp: now + 300,
    ...claimOverrides,
  });
  const content = `${header}.${claims}`;
  return `${content}.${sign('RSA-SHA256', Buffer.from(content), signingKey).toString('base64url')}`;
}

function cloudFrontEvent(uri, token, method = 'GET', extraHeaders = {}) {
  return {
    Records: [
      {
        cf: {
          request: {
            method,
            uri,
            headers: {
              authorization: [
                { key: 'Authorization', value: `Bearer ${token}` },
              ],
              ...extraHeaders,
            },
          },
        },
      },
    ],
  };
}

function createHandler() {
  return createEdgeAuthHandler(
    {
      region: 'ap-northeast-1',
      userPoolId: 'ap-northeast-1_test',
      clientId: 'test-client',
      statusKey: 'user_status.json',
    },
    async () => ({ keys: [jwk] }),
  );
}

test('authenticates Cognito tokens and rewrites status to the S3 object', async () => {
  const handler = createHandler();
  const request = cloudFrontEvent('/status', createToken()).Records[0].cf
    .request;
  const result = await handler({
    Records: [{ cf: { request } }],
  });
  const headResult = await handler(
    cloudFrontEvent('/status', createToken(), 'HEAD'),
  );

  assert.equal(result.uri, '/user_status.json');
  assert.equal(result.headers.authorization, undefined);
  assert.equal(result.headers['x-authenticated-card-no'], undefined);
  assert.equal(result.headers['x-authenticated-email'], undefined);
  assert.equal(headResult.uri, '/user_status.json');
});

test('allows status access without a verified email but requires it for subscriptions', async () => {
  const tokenWithoutEmail = createToken({ email: undefined });
  const handler = createHandler();
  const statusResult = await handler(
    cloudFrontEvent('/status', tokenWithoutEmail),
  );
  const subscriptionsResult = await handler(
    cloudFrontEvent('/subscriptions', tokenWithoutEmail, 'POST'),
  );

  assert.equal(statusResult.uri, '/user_status.json');
  assert.equal(statusResult.headers['x-authenticated-email'], undefined);
  assert.equal(subscriptionsResult.status, '401');
});

test('requires a verified email claim for subscriptions', async () => {
  const result = await createHandler()(
    cloudFrontEvent(
      '/subscriptions',
      createToken({ email_verified: false }),
      'POST',
    ),
  );

  assert.equal(result.status, '401');
});

test('rejects invalid signatures', async () => {
  const invalidSignature = await createHandler()(
    cloudFrontEvent(
      '/status',
      createToken(
        {},
        generateKeyPairSync('rsa', {
          modulusLength: 2048,
        }).privateKey,
      ),
    ),
  );

  assert.equal(invalidSignature.status, '401');
});

test('accepts an ID token from the configured user pool and client', async () => {
  const result = await createHandler()(
    cloudFrontEvent('/status', createToken()),
  );

  assert.equal(result.uri, '/user_status.json');
});

test('rejects the wrong token audience and expired ID tokens', async () => {
  const wrongAudience = await createHandler()(
    cloudFrontEvent(
      '/subscriptions',
      createToken({ aud: 'other-client' }),
      'POST',
    ),
  );
  const expired = await createHandler()(
    cloudFrontEvent('/subscriptions', createToken({ exp: 1 }), 'POST'),
  );

  assert.equal(wrongAudience.status, '401');
  assert.equal(expired.status, '401');
});

test('forwards only the verified email claim to the Push Lambda origin', async () => {
  const request = cloudFrontEvent('/subscriptions', createToken(), 'POST')
    .Records[0].cf.request;
  request.headers['x-cognito-id-token'] = [
    { key: 'X-Cognito-Id-Token', value: 'forged-token' },
  ];
  request.headers['x-authenticated-email'] = [
    { key: 'X-Authenticated-Email', value: 'forged@example.com' },
  ];

  const result = await createHandler()({
    Records: [{ cf: { request } }],
  });

  assert.equal(result.headers.authorization, undefined);
  assert.equal(result.headers['x-cognito-id-token'], undefined);
  assert.equal(
    result.headers['x-authenticated-email'][0].value,
    'member@example.com',
  );
});

test('rejects unsupported routes and methods', async () => {
  const handler = createHandler();
  const unknownPath = await handler(cloudFrontEvent('/unknown', createToken()));
  const wrongMethod = await handler(
    cloudFrontEvent('/status', createToken(), 'POST'),
  );

  assert.equal(unknownPath.status, '404');
  assert.equal(wrongMethod.status, '405');
});
