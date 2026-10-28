import { createPublicKey, verify } from 'node:crypto';

const jwksCache = new Map();
const jwksRequests = new Map();
const JWKS_TTL_MS = 5 * 60 * 1000;

export function createEdgeAuthHandler(configuration, loadJwks = fetchJwks) {
  const allowedUserIds = new Set(configuration.allowedUserIds);
  const issuer = `https://cognito-idp.${configuration.region}.amazonaws.com/${configuration.userPoolId}`;

  return async (event) => {
    const request = event.Records?.[0]?.cf?.request;
    if (!request) {
      return errorResponse(400, 'Invalid CloudFront request.');
    }

    removeHeader(request.headers, 'x-authenticated-sub');
    removeHeader(request.headers, 'x-authenticated-card-no');

    if (request.uri === '/status') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return errorResponse(405, 'Method not allowed.', { allow: 'GET, HEAD' });
      }
    } else if (request.uri === '/subscriptions') {
      if (request.method !== 'POST' && request.method !== 'DELETE') {
        return errorResponse(405, 'Method not allowed.', {
          allow: 'POST, DELETE',
        });
      }
    } else {
      return errorResponse(404, 'Not found.');
    }

    const token = readToken(request.headers);
    if (!token) {
      return errorResponse(401, 'Authentication is required.');
    }

    let claims;
    try {
      claims = await verifyIdToken(token, {
        ...configuration,
        issuer,
        allowedUserIds,
        loadJwks,
        requireCardNo: request.uri === '/subscriptions',
      });
    } catch (error) {
      if (error instanceof InvalidTokenError) {
        return errorResponse(401, 'The ID token is not authorized.');
      }
      console.error('Could not verify the Cognito signing key.', error);
      return errorResponse(503, 'Authentication is temporarily unavailable.');
    }

    removeHeader(request.headers, 'authorization');
    removeHeader(request.headers, 'x-cognito-id-token');
    request.headers['x-authenticated-sub'] = [
      { key: 'X-Authenticated-Sub', value: claims.sub },
    ];
    if (typeof claims['custom:cardNo'] === 'string') {
      request.headers['x-authenticated-card-no'] = [
        { key: 'X-Authenticated-Card-No', value: claims['custom:cardNo'] },
      ];
    }

    if (request.uri === '/status') {
      request.uri = `/${configuration.statusKey}`;
    }
    return request;
  };
}

async function verifyIdToken(token, configuration) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new InvalidTokenError('Malformed JWT.');
  }

  const header = parseJwtPart(parts[0]);
  const claims = parseJwtPart(parts[1]);
  if (
    header.alg !== 'RS256' ||
    typeof header.kid !== 'string' ||
    claims.iss !== configuration.issuer ||
    claims.token_use !== 'id' ||
    claims.aud !== configuration.clientId ||
    typeof claims.sub !== 'string' ||
    !configuration.allowedUserIds.has(claims.sub) ||
    (configuration.requireCardNo &&
      (typeof claims['custom:cardNo'] !== 'string' ||
        claims['custom:cardNo'].trim() === '')) ||
    !Number.isInteger(claims.exp) ||
    claims.exp <= Math.floor(Date.now() / 1000) ||
    !Number.isInteger(claims.iat) ||
    claims.iat > Math.floor(Date.now() / 1000) + 60
  ) {
    throw new InvalidTokenError('JWT claims are invalid.');
  }

  const jwks = await getCachedJwks(configuration.issuer, configuration.loadJwks);
  let jwk = jwks.keys.find((key) => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) {
    jwksCache.delete(configuration.issuer);
    const refreshed = await configuration.loadJwks(configuration.issuer);
    jwksCache.set(configuration.issuer, {
      expiresAt: Date.now() + JWKS_TTL_MS,
      value: refreshed,
    });
    jwk = refreshed.keys.find(
      (key) => key.kid === header.kid && key.kty === 'RSA',
    );
  }
  if (!jwk) {
    throw new InvalidTokenError('JWT signing key was not found.');
  }

  let validSignature;
  try {
    validSignature = verify(
      'RSA-SHA256',
      Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      decodeBase64Url(parts[2]),
    );
  } catch {
    throw new InvalidTokenError('JWT signature is invalid.');
  }
  if (!validSignature) {
    throw new InvalidTokenError('JWT signature is invalid.');
  }

  return claims;
}

async function getCachedJwks(issuer, loadJwks) {
  const cached = jwksCache.get(issuer);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  let request = jwksRequests.get(issuer);
  if (!request) {
    request = loadJwks(issuer);
    jwksRequests.set(issuer, request);
  }
  try {
    const value = await request;
    jwksCache.set(issuer, {
      expiresAt: Date.now() + JWKS_TTL_MS,
      value,
    });
    return value;
  } finally {
    jwksRequests.delete(issuer);
  }
}

function parseJwtPart(part) {
  try {
    const value = JSON.parse(decodeBase64Url(part).toString('utf8'));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('JWT part must be a JSON object.');
    }
    return value;
  } catch {
    throw new InvalidTokenError('JWT is malformed.');
  }
}

function decodeBase64Url(value) {
  if (!/^[\dA-Za-z_-]+$/.test(value)) {
    throw new InvalidTokenError('JWT contains invalid base64url data.');
  }
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function readToken(headers) {
  const authorization = firstHeader(headers, 'authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return bearer || firstHeader(headers, 'x-cognito-id-token') || null;
}

function firstHeader(headers, name) {
  return headers[name.toLowerCase()]?.[0]?.value?.trim() || null;
}

function removeHeader(headers, name) {
  delete headers[name.toLowerCase()];
}

function errorResponse(statusCode, message, additionalHeaders = {}) {
  return {
    status: String(statusCode),
    statusDescription: statusCode === 401 ? 'Unauthorized' : 'Request Failed',
    headers: {
      'cache-control': [{ key: 'Cache-Control', value: 'no-store' }],
      'content-type': [
        { key: 'Content-Type', value: 'application/json; charset=utf-8' },
      ],
      ...Object.fromEntries(
        Object.entries(additionalHeaders).map(([name, value]) => [
          name.toLowerCase(),
          [{ key: name, value }],
        ]),
      ),
    },
    body: JSON.stringify({ error: message }),
  };
}

async function fetchJwks(issuer) {
  const response = await fetch(`${issuer}/.well-known/jwks.json`, {
    signal: AbortSignal.timeout(2500),
  });
  if (!response.ok) {
    throw new Error(`Cognito JWKS request failed (HTTP ${response.status}).`);
  }
  const value = await response.json();
  if (!value || !Array.isArray(value.keys)) {
    throw new Error('Cognito returned an invalid JWKS document.');
  }
  return value;
}

class InvalidTokenError extends Error {}
