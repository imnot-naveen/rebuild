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

async function isolatedDatabase(t, url, ...migrations) {
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
  for (const migration of migrations) {
    const sql = await readFile(join(__dirname, '../../../db/migrations', migration), 'utf8');
    await db.query(sql);
  }
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

test('Request reporting and review access through Access and Relief Operations', async (t) => {
  const operations = await isolatedDatabase(t, process.env.DATABASE_URL,
    'operations/001-resident-requests.sql', 'operations/002-request-review.sql');
  const access = await isolatedDatabase(t, process.env.ACCESS_DATABASE_URL, 'access/001-resident-membership.sql');
  const event = randomUUID();
  const anotherEvent = randomUUID();
  const owner = randomUUID();
  const otherResident = randomUUID();
  const coordinator = randomUUID();
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
     VALUES ($1, $2, 'auth0|resident-a'), ($3, $2, 'auth0|resident-b'), ($4, $2, 'auth0|coordinator')`,
    [owner, issuer, otherResident, coordinator],
  );
  await access.db.query(
    `INSERT INTO event_member (event_id, user_id, role)
     VALUES ($1, $2, 'resident'), ($1, $3, 'resident'), ($4, $2, 'resident'),
            ($1, $5, 'coordinator'), ($4, $5, 'coordinator')`,
    [event, owner, otherResident, anotherEvent, coordinator],
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
  const coordinatorToken = await token('auth0|coordinator');

  function send(eventId, bearer, { key, body, requestId, action, query } = {}) {
    const headers = bearer ? { authorization: `Bearer ${bearer}` } : {};
    if (body) {
      headers['content-type'] = 'application/json';
      if (key) headers['idempotency-key'] = key;
    }
    const path = [requestId, action].filter(Boolean).join('/');
    const url = new URL(`/v1/events/${eventId}/requests${path ? '/' + path : ''}`, operationsApp.url);
    url.search = new URLSearchParams(query).toString();
    return httpFetch(url, {
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
      activity: [],
    });
  });

  await t.test('request list returns only summaries for the authenticated resident and event', async () => {
    assert.equal((await send(event)).status, 401);
    assert.equal((await send(anotherEvent, otherToken)).status, 403);
    const empty = await send(anotherEvent, ownerToken);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { requests: [], nextCursor: null });

    const otherResidentsReport = await send(event, otherToken, {
      key: randomUUID(),
      body: validReport,
    });
    assert.equal(otherResidentsReport.status, 201, await otherResidentsReport.text());
    const otherEventsReport = await send(anotherEvent, ownerToken, {
      key: randomUUID(),
      body: validReport,
    });
    assert.equal(otherEventsReport.status, 201, await otherEventsReport.text());

    const response = await send(event, ownerToken);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.json(), { requests: [report], nextCursor: null });
  });

  await t.test('request list pages correctly when timestamps share a millisecond', async () => {
    const ids = [report.id];
    for (let index = 0; index < 2; index += 1) {
      const response = await send(event, ownerToken, { key: randomUUID(), body: validReport });
      assert.equal(response.status, 201);
      ids.push((await response.json()).id);
    }
    const [lowId, middleId, highId] = ids.sort();
    await operations.db.query(
      `UPDATE assistance_request
          SET created_at = CASE WHEN id = $1 THEN '2026-11-17T12:00:00.000101Z'::timestamptz
                                ELSE '2026-11-17T12:00:00.000102Z'::timestamptz END
        WHERE id IN ($1, $2, $3)`,
      [highId, lowId, middleId],
    );

    let cursor;
    for (const [index, id] of [middleId, lowId, highId].entries()) {
      const query = { limit: '1' };
      if (cursor) query.cursor = cursor;
      const response = await send(event, ownerToken, { query });
      assert.equal(response.status, 200, await response.clone().text());
      const page = await response.json();
      assert.deepEqual(page.requests.map((request) => request.id), [id]);
      if (index < 2) assert.equal(typeof page.nextCursor, 'string');
      cursor = page.nextCursor;
    }
    assert.equal(cursor, null);

    for (const query of [{ limit: '101' }, { cursor: 'invalid' }]) {
      assert.equal((await send(event, ownerToken, { query })).status, 400);
    }
  });

  await t.test('coordinator reads the event queue and detail while resident ownership still applies', async () => {
    const { rows: [otherReport] } = await operations.db.query(
      `UPDATE assistance_request SET review_state = 'needs_clarification'
        WHERE event_id = $1 AND resident_id = $2
        RETURNING id`,
      [event, otherResident],
    );
    assert.ok(otherReport);

    const queue = await send(event, coordinatorToken);
    assert.equal(queue.status, 200, await queue.clone().text());
    const { requests, nextCursor } = await queue.json();
    assert.equal(requests.length, 4);
    assert.equal(nextCursor, null);
    assert.ok(requests.some(({ id }) => id === report.id));
    assert.ok(requests.some(({ id }) => id === otherReport.id));
    assert.ok(requests.every((row) => !('location' in row) && !('description' in row)));

    const query = { reviewState: 'needs_clarification' };
    const filtered = await send(event, coordinatorToken, { query });
    assert.equal(filtered.status, 200);
    assert.deepEqual((await filtered.json()).requests.map(({ id }) => id), [otherReport.id]);
    const residentQueue = await send(event, ownerToken, { query });
    assert.equal(residentQueue.status, 200);
    assert.deepEqual(await residentQueue.json(), { requests: [], nextCursor: null });
    assert.equal((await send(event, coordinatorToken, { query: { reviewState: 'unknown' } })).status, 400);

    const detail = await send(event, coordinatorToken, { requestId: otherReport.id });
    assert.equal(detail.status, 200);
    assert.deepEqual((await detail.json()).location, validReport.location);
    assert.equal((await send(anotherEvent, coordinatorToken, { requestId: otherReport.id })).status, 404);
    assert.equal((await send(event, coordinatorToken, { key: randomUUID(), body: validReport })).status, 403);
    assert.deepEqual(await (await send(event, coordinatorToken, { requestId: 'access' })).json(), { role: 'coordinator' });
    assert.deepEqual(await (await send(event, ownerToken, { requestId: 'access' })).json(), { role: 'resident' });

    await access.db.query(
      "UPDATE event_member SET role = 'volunteer' WHERE event_id = $1 AND user_id = $2",
      [event, coordinator],
    );
    assert.equal((await send(event, coordinatorToken)).status, 403);
    assert.equal((await send(event, coordinatorToken, { requestId: otherReport.id })).status, 403);
    assert.equal((await send(event, coordinatorToken, { requestId: 'access' })).status, 403);
    await access.db.query(
      "UPDATE event_member SET role = 'coordinator' WHERE event_id = $1 AND user_id = $2",
      [event, coordinator],
    );
  });

  const forReview = await send(event, ownerToken, { key: randomUUID(), body: validReport });
  assert.equal(forReview.status, 201);
  const reviewReport = await forReview.json();

  function review(bearer, action, body, { requestId = reviewReport.id, eventId = event, key = randomUUID() } = {}) {
    return send(eventId, bearer, { requestId, action, key, body });
  }

  await t.test('concurrent clarification, replay, and the owning resident reply keep one versioned history', async () => {
    const questions = [
      { key: randomUUID(), body: { version: 1, question: 'Can you confirm the delivery entrance?' } },
      { key: randomUUID(), body: { version: 1, question: 'When can you receive water?' } },
    ];
    assert.equal((await review(ownerToken, 'clarifications', questions[0].body)).status, 403);
    assert.equal((await review(coordinatorToken, 'clarifications', { version: 1, question: '   ' })).status, 400);

    const outcomes = await Promise.all(questions.map(({ key, body }) => review(coordinatorToken, 'clarifications', body, { key })));
    assert.deepEqual(outcomes.map(({ status }) => status).sort(), [200, 409]);
    const success = outcomes.findIndex(({ status }) => status === 200);
    const saved = await outcomes[success].json();
    const winningQuestion = questions[success];
    assert.deepEqual(saved, { ...reviewReport, reviewState: 'needs_clarification', version: 2 });
    assert.equal((await outcomes[1 - success].json()).message, 'The request version has changed');
    const replay = await review(coordinatorToken, 'clarifications', winningQuestion.body, winningQuestion);
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), saved);
    assert.equal((await review(coordinatorToken, 'clarifications', { version: 2, question: 'Another question?' })).status, 409);
    assert.equal((await review(coordinatorToken, 'clarifications',
      { ...winningQuestion.body, question: 'Changed question' }, winningQuestion)).status, 409);
    const originalDetail = await (await send(event, ownerToken, { requestId: reviewReport.id })).json();
    assert.equal(originalDetail.activity.length, 1);
    assert.equal(originalDetail.activity[0].text, winningQuestion.body.question);

    const reply = { version: 2, reply: 'Use the north entrance.' };
    assert.equal((await review(otherToken, 'replies', reply)).status, 404);
    assert.equal((await review(coordinatorToken, 'replies', reply)).status, 403);
    const answer = await review(ownerToken, 'replies', reply);
    assert.equal(answer.status, 200, await answer.clone().text());
    assert.deepEqual(await answer.json(), { ...reviewReport, version: 3 });
    const list = await (await send(event, ownerToken)).json();
    const updated = list.requests.find(({ id }) => id === reviewReport.id);
    assert.equal(updated.version, 3);
    assert.equal(updated.reviewState, 'submitted');

    const { rows } = await operations.db.query(
      'SELECT operation, actor_id FROM audit_entry WHERE request_id = $1 ORDER BY created_at', [reviewReport.id],
    );
    assert.deepEqual(rows, [
      { operation: 'request.create', actor_id: owner },
      { operation: 'request.clarify', actor_id: coordinator },
      { operation: 'request.reply', actor_id: owner },
    ]);
    const failed = await operations.db.query('SELECT 1 FROM idempotency_record WHERE operation_key = $1',
      [questions[1 - success].key]);
    assert.equal(failed.rowCount, 0);
  });

  await t.test('verification and duplicate rejection persist while protected notes stay coordinator-only', async () => {
    const command = {
      version: 3,
      confirmedQuantity: 6,
      urgency: 'urgent',
      source: { type: 'shelter_intake', reference: 'DEMO-42' },
      rationale: 'Intake and organizer confirmed the address and the requested need.',
    };
    assert.equal((await review(ownerToken, 'verification', command)).status, 403);
    assert.equal((await review(coordinatorToken, 'verification', command, { eventId: anotherEvent })).status, 404);
    assert.equal((await review(coordinatorToken, 'verification', { ...command, urgency: 'unknown' })).status, 400);
    const key = randomUUID();
    const verification = await review(coordinatorToken, 'verification', command, { key });
    assert.equal(verification.status, 200, await verification.clone().text());
    assert.deepEqual(await verification.json(), {
      ...reviewReport, version: 4, reviewState: 'verified', verifiedQuantity: 6, verifiedUrgency: 'urgent',
    });
    const coordinatorDetail = await (await send(event, coordinatorToken, { requestId: reviewReport.id })).json();
    assert.deepEqual(coordinatorDetail.activity.map(({ action }) => action), ['clarify', 'reply', 'verify']);
    assert.deepEqual(coordinatorDetail.activity.at(-1).source, command.source);
    assert.equal(coordinatorDetail.activity.at(-1).rationale, command.rationale);
    const residentDetail = await (await send(event, ownerToken, { requestId: reviewReport.id })).json();
    assert.equal(residentDetail.reviewState, 'verified');
    assert.equal(residentDetail.activity.at(-1).confirmedQuantity, 6);
    assert.ok(residentDetail.activity.every((entry) => !('source' in entry || 'rationale' in entry || 'actorId' in entry)));
    const queue = await send(event, coordinatorToken, { query: { reviewState: 'verified', urgency: 'urgent' } });
    assert.equal(queue.status, 200);
    assert.deepEqual((await queue.json()).requests.map(({ id }) => id), [reviewReport.id]);
    assert.equal((await review(coordinatorToken, 'rejection', { version: 4, reason: 'Already verified' })).status, 409);

    const newReport = await (await send(event, otherToken, { body: validReport, key: randomUUID() })).json();
    const foreign = await (await send(anotherEvent, coordinatorToken)).json();
    const rejection = { version: 1, reason: 'Already recorded for this household.', duplicateOfRequestId: reviewReport.id };
    assert.equal((await review(coordinatorToken, 'rejection', { ...rejection, duplicateOfRequestId: foreign.requests[0].id },
      { requestId: newReport.id })).status, 404);
    const rejected = await review(coordinatorToken, 'rejection', rejection, { requestId: newReport.id });
    assert.equal(rejected.status, 200, await rejected.clone().text());
    assert.equal((await rejected.json()).reviewState, 'rejected');
    const rejectedDetail = await (await send(event, otherToken, { requestId: newReport.id })).json();
    assert.equal(rejectedDetail.activity[0].text, rejection.reason);
    assert.equal(rejectedDetail.activity[0].relatedRequestId, undefined);
    const linked = await review(coordinatorToken, 'related-reports', { version: 4, relatedRequestId: newReport.id });
    assert.equal(linked.status, 200, await linked.clone().text());
    assert.equal((await linked.json()).reviewState, 'verified');
    const linkedDetail = await (await send(event, coordinatorToken, { requestId: reviewReport.id })).json();
    assert.equal(linkedDetail.activity.at(-1).relatedRequestId, newReport.id);
    assert.equal((await (await send(event, ownerToken, { requestId: reviewReport.id })).json()).activity.length, 3);

    await access.db.query("UPDATE event_member SET role = 'volunteer' WHERE event_id = $1 AND user_id = $2",
      [event, coordinator]);
    assert.equal((await review(coordinatorToken, 'verification', command, { key })).status, 403);
  });

  await t.test('Operations fails closed when Access is unavailable', async () => {
    await accessApp.close();
    const response = await send(event, ownerToken, { requestId: report.id });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'service_unavailable');
  });
});
