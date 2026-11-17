require('reflect-metadata');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { test } = require('node:test');
const { NestFactory } = require('@nestjs/core');
const { exportJWK, generateKeyPair, SignJWT } = require('jose');
const { Pool } = require('pg');
const { AccessModule } = require('../dist/access/access.module');
const { AppModule } = require('../dist/app.module');

const validReport = {
  category: 'drinking-water',
  unit: 'cases',
  quantity: 8,
  description: 'Drinking water for a synthetic household',
  location: { latitude: 6.93, longitude: 79.86 },
};

async function isolatedDatabase(t, url, migration) {
  assert.ok(url, 'Set DATABASE_URL and ACCESS_DATABASE_URL or copy .env.example to .env');
  const schema = 'r03_' + randomUUID().replaceAll('-', '');
  const admin = new Pool({ connectionString: url });
  t.after(async () => {
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  });
  await admin.query(`CREATE SCHEMA ${schema}`);

  const scoped = new URL(url);
  scoped.searchParams.set('options', `-c search_path=${schema},public`);
  const db = new Pool({ connectionString: scoped.href });
  t.after(() => db.end());
  const sql = await readFile(join(__dirname, '../../../db/migrations', migration), 'utf8');
  await db.query(sql);
  return { db, url: scoped.href };
}

async function listen(t, module) {
  const app = await NestFactory.create(module, { logger: false, abortOnError: false });
  let closed = false;
  async function close() {
    if (!closed) {
      closed = true;
      await app.close();
    }
  }
  t.after(close);
  await app.listen(0, '127.0.0.1');
  return { url: await app.getUrl(), close };
}

test('R03 resident reporting through Access and Relief Operations', async (t) => {
  const operations = await isolatedDatabase(t, process.env.DATABASE_URL, 'operations/001-resident-requests.sql');
  const access = await isolatedDatabase(t, process.env.ACCESS_DATABASE_URL, 'access/001-resident-membership.sql');
  const event = randomUUID();
  const anotherEvent = randomUUID();
  const owner = randomUUID();
  const otherResident = randomUUID();
  const issuer = 'https://rebuild-r03.example/';
  const audience = 'https://api.rebuild-r03.example';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const kid = 'r03-test';
  const jwk = { ...(await exportJWK(publicKey)), kid, alg: 'RS256' };
  const httpFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', async (url, ...args) => {
    if (String(url) === new URL('.well-known/jwks.json', issuer).href) {
      return Response.json({ keys: [jwk] });
    }
    return httpFetch(url, ...args);
  });

  await operations.db.query('INSERT INTO relief_event (id) VALUES ($1), ($2)', [event, anotherEvent]);
  await operations.db.query("INSERT INTO category (code, unit) VALUES ('drinking-water', 'cases')");
  await access.db.query(
    `INSERT INTO app_user (id, oidc_issuer, oidc_subject)
     VALUES ($1, $2, 'auth0|resident-a'), ($3, $2, 'auth0|resident-b')`,
    [owner, issuer, otherResident],
  );
  await access.db.query(
    `INSERT INTO event_member (event_id, user_id, role)
     VALUES ($1, $2, 'resident'), ($1, $3, 'resident'), ($4, $2, 'resident')`,
    [event, owner, otherResident, anotherEvent],
  );

  process.env.DATABASE_URL = operations.url;
  process.env.ACCESS_DATABASE_URL = access.url;
  process.env.AUTH0_ISSUER = issuer;
  process.env.AUTH0_AUDIENCE = audience;
  process.env.ACCESS_INTERNAL_KEY = randomUUID();
  const accessApp = await listen(t, AccessModule);
  process.env.ACCESS_URL = accessApp.url;
  const operationsApp = await listen(t, AppModule);

  function token(subject) {
    return new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', kid })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject(subject)
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  const ownerToken = await token('auth0|resident-a');
  const otherToken = await token('auth0|resident-b');

  function send(eventId, bearer, { key, body, requestId } = {}) {
    const headers = bearer ? { authorization: `Bearer ${bearer}` } : {};
    if (body) {
      headers['content-type'] = 'application/json';
      if (key) headers['idempotency-key'] = key;
    }
    const path = `/v1/events/${eventId}/requests${requestId ? '/' + requestId : ''}`;
    return httpFetch(operationsApp.url + path, {
      method: body ? 'POST' : 'GET',
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(6000),
    });
  }

  const key = randomUUID();
  const body = { ...validReport, residentId: otherResident };
  const [created, concurrentRetry] = await Promise.all([
    send(event, ownerToken, { key, body }),
    send(event, ownerToken, { key, body }),
  ]);
  assert.equal(created.status, 201, await created.clone().text());
  assert.equal(concurrentRetry.status, 201, await concurrentRetry.clone().text());
  const report = await created.json();
  assert.deepEqual(await concurrentRetry.json(), report);

  await t.test('one submitted request and audit entry persist under the authenticated resident', async () => {
    assert.equal(report.reviewState, 'submitted');
    assert.equal(report.version, 1);
    assert.equal(report.location, undefined, 'the replay body excludes the exact location');
    assert.deepEqual((await operations.db.query(
      `SELECT resident_id, description, ST_X(location::geometry) AS longitude,
              ST_Y(location::geometry) AS latitude FROM assistance_request`,
    )).rows, [{
      resident_id: owner,
      description: validReport.description,
      longitude: validReport.location.longitude,
      latitude: validReport.location.latitude,
    }]);
    assert.deepEqual((await operations.db.query('SELECT request_id, actor_id FROM audit_entry')).rows, [
      { request_id: report.id, actor_id: owner },
    ]);
  });

  await t.test('submission rejects invalid input and changed retries and checks current permission on replay', async () => {
    const post = (token, key, body) => send(event, token, { key, body });
    assert.equal((await post(undefined, randomUUID(), validReport)).status, 401);
    assert.equal((await post(ownerToken, undefined, validReport)).status, 400);
    assert.equal((await post(ownerToken, randomUUID(), { ...validReport, quantity: 0 })).status, 400);
    const failedKey = randomUUID();
    assert.equal((await post(ownerToken, failedKey, { ...validReport, unit: 'litres' })).status, 400);
    assert.equal((await operations.db.query(
      'SELECT 1 FROM idempotency_record WHERE operation_key = $1', [failedKey],
    )).rowCount, 0);
    assert.equal((await post(ownerToken, key, { ...validReport, quantity: 9 })).status, 409);
    await access.db.query("UPDATE event_member SET role = 'volunteer' WHERE event_id = $1 AND user_id = $2", [event, owner]);
    try {
      assert.equal((await post(ownerToken, key, validReport)).status, 403);
    } finally {
      await access.db.query("UPDATE event_member SET role = 'resident' WHERE event_id = $1 AND user_id = $2", [event, owner]);
    }
  });

  await t.test('another resident, another event and an unknown request ID all get the same 404', async () => {
    for (const [eventId, bearer, requestId] of [
      [event, otherToken, report.id],
      [anotherEvent, ownerToken, report.id],
      [event, ownerToken, randomUUID()],
    ]) {
      const response = await send(eventId, bearer, { requestId });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { code: 'not_found', message: 'Request not found' });
    }
  });

  await t.test('owner can read the persisted request and its exact location', async () => {
    const response = await send(event, ownerToken, { requestId: report.id });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ...report,
      description: validReport.description,
      location: validReport.location,
    });
  });

  await t.test('Operations fails closed when Access is unavailable', async () => {
    await accessApp.close();
    const response = await send(event, ownerToken, { requestId: report.id });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'service_unavailable');
  });
});
