require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NestFactory } = require('@nestjs/core');
const { SignJWT, exportJWK, generateKeyPair } = require('jose');
const { AppModule } = require('../dist/app.module');

test('GET /auth/check validates an RS256 bearer access token', async (t) => {
  const issuer = 'https://rebuild-test.example/';
  const audience = 'https://api.rebuild-test.example';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const otherKeyPair = await generateKeyPair('RS256');
  const keyId = 'r02b-test-key';
  const jwk = { ...(await exportJWK(publicKey)), kid: keyId, alg: 'RS256' };
  const fetchApi = globalThis.fetch;

  let signingKeysAvailable = false;
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(String(url), new URL('.well-known/jwks.json', issuer).href);
    if (!signingKeysAvailable) {
      return new Response(null, { status: 503 });
    }
    return Response.json({ keys: [jwk] });
  });

  const previousIssuer = process.env.AUTH0_ISSUER;
  const previousAudience = process.env.AUTH0_AUDIENCE;
  process.env.AUTH0_ISSUER = issuer;
  process.env.AUTH0_AUDIENCE = audience;
  t.after(() => {
    for (const [name, value] of [
      ['AUTH0_ISSUER', previousIssuer],
      ['AUTH0_AUDIENCE', previousAudience],
    ]) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  t.after(() => app.close());
  await app.listen(0, '127.0.0.1');
  const url = `${await app.getUrl()}/auth/check`;
  const now = Math.floor(Date.now() / 1000);

  function sign(claims = {}, key = privateKey) {
    return new SignJWT({ iss: issuer, aud: audience, sub: 'auth0|test-user', exp: now + 60, ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: keyId })
      .sign(key);
  }

  async function status(authorization) {
    const response = await fetchApi(url, {
      headers: authorization ? { authorization } : {},
      signal: AbortSignal.timeout(5000),
    });
    await response.text();
    return response.status;
  }

  assert.equal(await status(), 401);
  assert.equal(await status('Bearer invalid-token'), 401);
  assert.equal(await status(`Bearer ${await sign()}`), 503);
  signingKeysAvailable = true;
  assert.equal(await status(`Bearer ${await sign()}`), 204);

  for (const [reason, claims, key] of [
    ['wrong issuer', { iss: 'https://other-issuer.example/' }],
    ['wrong audience', { aud: 'https://other-api.example' }],
    ['expired', { exp: now - 60 }],
    ['missing expiry', { exp: undefined }],
    ['missing subject', { sub: undefined }],
    ['wrong signature', {}, otherKeyPair.privateKey],
  ]) {
    assert.equal(await status(`Bearer ${await sign(claims, key)}`), 401, reason);
  }
});
