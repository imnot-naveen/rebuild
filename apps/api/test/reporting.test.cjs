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
const { MatchingModule } = require('../dist/matching/matching.module');

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
    'operations/001-resident-requests.sql', 'operations/002-request-review.sql',
    'operations/003-stock-lots.sql', 'operations/004-assignments.sql', 'operations/005-stock-adjustments.sql',
    'operations/006-stock-matching.sql');
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
  let volunteerLookupUnavailable = false;
  t.mock.method(globalThis, 'fetch', async (url, ...args) => {
    if (String(url) === new URL('.well-known/jwks.json', issuer).href) {
      return Response.json({ keys: [jwk] });
    }
    if (volunteerLookupUnavailable && String(url).includes('/volunteers/')) {
      return new Response(null, { status: 503 });
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
  process.env.MATCHING_INTERNAL_KEY = randomUUID();
  const matchingApp = await listen(t, MatchingModule);
  process.env.MATCHING_URL = matchingApp.url;
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

  function send(eventId, bearer, { key, body, requestId, action, query, resource = 'requests',
    method = body ? 'POST' : 'GET' } = {}) {
    const headers = bearer ? { authorization: `Bearer ${bearer}` } : {};
    if (body) {
      headers['content-type'] = 'application/json';
      if (key) headers['idempotency-key'] = key;
    }
    const path = [requestId, action].filter(Boolean).join('/');
    const url = new URL(`/v1/events/${eventId}/${resource}${path ? '/' + path : ''}`, operationsApp.url);
    url.search = new URLSearchParams(query).toString();
    return httpFetch(url, {
      method,
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

  await t.test('coordinator stock entry persists one lot and audit entry on replay', async () => {
    const input = {
      category: validReport.category,
      unit: validReport.unit,
      receivedQuantity: 8,
      location: validReport.location,
    };
    const stockKey = randomUUID();
    const createLot = (bearer, body, operationKey = stockKey) =>
      send(event, bearer, { key: operationKey, body, resource: 'stock-lots' });
    const listLots = (eventId, bearer, query) => send(eventId, bearer, { query, resource: 'stock-lots' });
    const failedKey = randomUUID();
    assert.equal((await createLot(coordinatorToken, { ...input, unit: 'litres' }, failedKey)).status, 400);
    assert.equal((await createLot(coordinatorToken, { ...input, receivedQuantity: 0 })).status, 400);
    assert.equal((await createLot(coordinatorToken, { ...input, location: { ...input.location, latitude: 91 } })).status, 400);
    assert.equal((await createLot(ownerToken, input)).status, 403);
    assert.equal((await listLots(event, ownerToken)).status, 403);
    assert.equal((await operations.db.query(
      'SELECT 1 FROM idempotency_record WHERE operation_key = $1', [failedKey],
    )).rowCount, 0);

    const [created, replayed] = await Promise.all([
      createLot(coordinatorToken, input), createLot(coordinatorToken, input),
    ]);
    assert.equal(created.status, 201, await created.clone().text());
    assert.equal(replayed.status, 201, await replayed.clone().text());
    const lot = await created.json();
    assert.deepEqual(await replayed.json(), lot);
    assert.equal(lot.receivedQuantity, 8);
    assert.equal(lot.availableQuantity, 8);
    assert.equal(lot.reservedQuantity, 0);
    assert.equal(lot.deliveredQuantity, 0);
    assert.equal(lot.version, 1);
    assert.equal(lot.location, undefined);
    assert.equal((await createLot(coordinatorToken, { ...input, receivedQuantity: 9 })).status, 409);
    assert.equal((await operations.db.query('SELECT 1 FROM stock_lot')).rowCount, 1);
    assert.deepEqual((await operations.db.query(
      'SELECT actor_id, stock_lot_id, operation FROM audit_entry WHERE stock_lot_id IS NOT NULL',
    )).rows, [{ actor_id: coordinator, stock_lot_id: lot.id, operation: 'stock_lot.create' }]);
    await assert.rejects(operations.db.query('UPDATE stock_lot SET reserved_quantity = 9 WHERE id = $1', [lot.id]),
      { code: '23514' });

    const detail = (eventId, bearer) => send(eventId, bearer, { requestId: lot.id, resource: 'stock-lots' });
    assert.deepEqual(await (await detail(event, coordinatorToken)).json(), { ...lot, location: input.location });
    assert.equal((await detail(anotherEvent, coordinatorToken)).status, 404);
    assert.deepEqual(await (await listLots(anotherEvent, coordinatorToken)).json(), { stockLots: [], nextCursor: null });
    const second = await createLot(coordinatorToken, input, failedKey);
    assert.equal(second.status, 201, await second.clone().text());
    const secondLot = await second.json();
    const page = await (await listLots(event, coordinatorToken, { category: input.category, limit: '1' })).json();
    assert.equal(page.stockLots.length, 1);
    assert.ok(page.nextCursor);
    const next = await (await listLots(event, coordinatorToken, {
      category: input.category, limit: '1', cursor: page.nextCursor,
    })).json();
    assert.equal(next.nextCursor, null);
    assert.equal(next.stockLots.length, 1);
    assert.deepEqual(new Set([page.stockLots[0].id, next.stockLots[0].id]), new Set([lot.id, secondLot.id]));
    assert.deepEqual(await (await listLots(event, coordinatorToken, { category: 'blankets' })).json(),
      { stockLots: [], nextCursor: null });
  });

  await t.test('stock adjustments check scope and version, record the reason and replay safely', async () => {
    const location = { latitude: 6.91, longitude: 79.87 };
    const original = { category: 'drinking-water', unit: 'cases', receivedQuantity: 8, location };
    const lot = await (await send(event, coordinatorToken, {
      body: original, key: randomUUID(), resource: 'stock-lots',
    })).json();
    const adjust = (body, options = {}) => send(options.eventId ?? event, options.token ?? coordinatorToken, {
      method: 'PATCH', resource: 'stock-lots', requestId: lot.id, key: options.key ?? randomUUID(), body,
    });
    assert.equal((await adjust({ version: 1, receivedQuantity: 0 })).status, 400);
    assert.equal((await adjust({ version: 1 })).status, 400);
    assert.equal((await adjust({ version: 1, location }, { eventId: anotherEvent })).status, 404);
    assert.equal((await adjust({ version: 1, location }, { token: ownerToken })).status, 403);

    const changedLocation = { latitude: 6.92, longitude: 79.88 };
    const key = randomUUID();
    const command = { version: 1, receivedQuantity: 0, reason: '  Recounted stock  ', location: changedLocation };
    const [updated, replay] = await Promise.all([adjust(command, { key }), adjust(command, { key })]);
    assert.equal(updated.status, 200, await updated.clone().text());
    assert.equal(replay.status, 200);
    const stock = await updated.json();
    assert.deepEqual(await replay.json(), stock);
    assert.deepEqual(stock, { ...lot, version: 2, availableQuantity: 0, receivedQuantity: 0 });
    assert.equal((await adjust({ ...command, reason: 'Changed the reason' }, { key })).status, 409);
    const stale = await adjust({ ...command, receivedQuantity: 2 });
    assert.equal(stale.status, 409);
    assert.deepEqual(await stale.json(), {
      code: 'STALE_VERSION', message: 'The stock lot version has changed', details: { version: 2 },
    });
    assert.deepEqual((await operations.db.query(
      "SELECT reason FROM audit_entry WHERE stock_lot_id = $1 AND operation = 'stock_lot.adjust'", [lot.id],
    )).rows, [{ reason: 'Recounted stock' }]);
    const detail = await send(event, coordinatorToken, { requestId: lot.id, resource: 'stock-lots' });
    assert.deepEqual(await detail.json(), { ...stock, location: changedLocation });

    const moved = await adjust({ version: 2, location });
    assert.equal(moved.status, 200);
    assert.deepEqual(await moved.json(), { ...stock, version: 3 });
  });

  await t.test('assignment reservation checks eligibility and commits stock, request, audit and replay together', async (t) => {
    const volunteer = randomUUID();
    const foreignVolunteer = randomUUID();
    const otherCoordinator = randomUUID();
    await access.db.query(
      `INSERT INTO app_user (id, oidc_issuer, oidc_subject)
       VALUES ($1, $4, 'auth0|volunteer'), ($2, $4, 'auth0|foreign-volunteer'), ($3, $4, 'auth0|second-coordinator')`,
      [volunteer, foreignVolunteer, otherCoordinator, issuer],
    );
    await access.db.query(
      `INSERT INTO event_member (event_id, user_id, role)
       VALUES ($1, $3, 'volunteer'), ($2, $4, 'volunteer'), ($1, $5, 'coordinator')`,
      [event, anotherEvent, volunteer, foreignVolunteer, otherCoordinator],
    );
    await operations.db.query("INSERT INTO category (code, unit) VALUES ('blankets', 'bundles')");
    const secondCoordinatorToken = await token('auth0|second-coordinator');

    async function newRequest(verify = true, body = validReport) {
      const created = await send(event, ownerToken, { body, key: randomUUID() });
      assert.equal(created.status, 201, await created.clone().text());
      const request = await created.json();
      if (!verify) return request;
      const verified = await send(event, coordinatorToken, {
        requestId: request.id, action: 'verification', key: randomUUID(),
        body: { version: request.version, confirmedQuantity: 8, urgency: 'routine',
          source: { type: 'field_lead', reference: 'synthetic-allocation' }, rationale: 'Confirmed eight cases' },
      });
      assert.equal(verified.status, 200, await verified.clone().text());
      return verified.json();
    }

    async function newLot(eventId = event, category = validReport.category, unit = validReport.unit) {
      const created = await send(eventId, coordinatorToken, {
        resource: 'stock-lots', key: randomUUID(),
        body: { category, unit, receivedQuantity: 8, location: validReport.location },
      });
      assert.equal(created.status, 201, await created.clone().text());
      return created.json();
    }

    function assign(request, lot, options = {}) {
      return send(event, options.bearer ?? coordinatorToken, {
        resource: 'assignments', key: options.key ?? randomUUID(),
        body: { requestId: request.id, requestVersion: request.version, lotId: lot.id,
          volunteerId: volunteer, quantity: 5, instructions: 'Meet the site coordinator', ...options.body },
      });
    }

    async function balance(lot) {
      const result = await operations.db.query(
        `SELECT reserved_quantity AS reserved, received_quantity - reserved_quantity - delivered_quantity AS available,
                version FROM stock_lot WHERE id = $1`, [lot.id],
      );
      return result.rows[0];
    }

    await t.test('rejects invalid roles, event scope and request or lot eligibility', async () => {
      const request = await newRequest();
      const lot = await newLot();
      assert.equal((await assign(request, lot, { bearer: ownerToken })).status, 403);
      assert.equal((await assign(request, lot, { body: { quantity: 0 } })).status, 400);
      for (const candidate of [owner, foreignVolunteer, randomUUID()]) {
        const rejected = await assign(request, lot, { body: { volunteerId: candidate } });
        assert.equal(rejected.status, 400);
        assert.equal((await rejected.json()).code, 'INVALID_VOLUNTEER');
      }
      const unverified = await assign(await newRequest(false), lot);
      assert.equal(unverified.status, 409);
      assert.equal((await unverified.json()).code, 'REQUEST_NOT_VERIFIED');
      const incompatible = await assign(request, await newLot(event, 'blankets', 'bundles'));
      assert.equal(incompatible.status, 409);
      assert.equal((await incompatible.json()).code, 'INCOMPATIBLE_STOCK');
      assert.equal((await assign(request, await newLot(anotherEvent))).status, 404);
      assert.deepEqual(await balance(lot), { reserved: 0, available: 8, version: 1 });
    });

    await t.test('two coordinators competing for the last stock commit one assignment', async () => {
      const lot = await newLot();
      const requests = [await newRequest(), await newRequest()];
      const attempts = [
        { key: randomUUID(), bearer: coordinatorToken }, { key: randomUUID(), bearer: secondCoordinatorToken },
      ];
      const responses = await Promise.all(requests.map((request, index) => assign(request, lot, attempts[index])));
      assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
      const winner = responses.findIndex(({ status }) => status === 201);
      const loser = 1 - winner;
      const assignment = await responses[winner].json();
      const conflict = await responses[loser].json();
      assert.equal(conflict.code, 'INSUFFICIENT_STOCK');
      assert.deepEqual(conflict.details, { availableQuantity: 3 });
      assert.equal(assignment.state, 'assigned');
      assert.equal(assignment.allocatableQuantity, 3);
      assert.equal(assignment.requestVersion, requests[winner].version + 1);
      assert.equal(assignment.lotVersion, 2);
      assert.equal(assignment.instructions, undefined);
      assert.deepEqual(await balance(lot), { reserved: 5, available: 3, version: 2 });
      assert.deepEqual((await operations.db.query(
        'SELECT id, instructions FROM assignment WHERE stock_lot_id = $1', [lot.id],
      )).rows, [{ id: assignment.id, instructions: 'Meet the site coordinator' }]);
      assert.deepEqual((await operations.db.query(
        'SELECT assignment_id, request_id FROM audit_entry WHERE stock_lot_id = $1 AND assignment_id IS NOT NULL', [lot.id],
      )).rows, [{ assignment_id: assignment.id, request_id: requests[winner].id }]);
      assert.equal((await operations.db.query('SELECT 1 FROM idempotency_record WHERE operation_key = $1',
        [attempts[loser].key])).rowCount, 0);

      const changed = await assign(requests[winner], lot, { ...attempts[winner], body: { quantity: 4 } });
      assert.equal(changed.status, 409);
      await access.db.query("UPDATE event_member SET role = 'resident' WHERE event_id = $1 AND user_id = $2", [event, volunteer]);
      try {
        const replay = await assign(requests[winner], lot, attempts[winner]);
        assert.equal(replay.status, 201);
        assert.deepEqual(await replay.json(), assignment);
        volunteerLookupUnavailable = true;
        assert.equal((await assign(requests[loser], lot)).status, 503);
        const outageReplay = await assign(requests[winner], lot, attempts[winner]);
        assert.equal(outageReplay.status, 201);
        assert.deepEqual(await outageReplay.json(), assignment);
      } finally {
        volunteerLookupUnavailable = false;
        await access.db.query("UPDATE event_member SET role = 'volunteer' WHERE event_id = $1 AND user_id = $2", [event, volunteer]);
      }
      const winnerId = winner === 0 ? coordinator : otherCoordinator;
      await access.db.query("UPDATE event_member SET role = 'resident' WHERE event_id = $1 AND user_id = $2", [event, winnerId]);
      try {
        assert.equal((await assign(requests[winner], lot, attempts[winner])).status, 403);
      } finally {
        await access.db.query("UPDATE event_member SET role = 'coordinator' WHERE event_id = $1 AND user_id = $2", [event, winnerId]);
      }
    });

    await t.test('two lots serving one request cannot reserve more than the confirmed need', async () => {
      const request = await newRequest();
      const lots = [await newLot(), await newLot()];
      const responses = await Promise.all([
        assign(request, lots[0]), assign(request, lots[1], { bearer: secondCoordinatorToken }),
      ]);
      assert.deepEqual(responses.map(({ status }) => status).sort(), [201, 409]);
      const winner = responses.findIndex(({ status }) => status === 201);
      const stale = await responses[1 - winner].json();
      assert.equal(stale.code, 'STALE_VERSION');
      assert.equal(stale.details.version, request.version + 1);
      const losingLot = lots[1 - winner];
      const retry = await assign({ ...request, version: stale.details.version }, losingLot);
      assert.equal(retry.status, 409);
      assert.deepEqual(await retry.json(), {
        code: 'INSUFFICIENT_NEED', message: 'The request has less allocatable need than this assignment',
        details: { allocatableQuantity: 3 },
      });
      assert.deepEqual(await balance(losingLot), { reserved: 0, available: 8, version: 1 });
    });

    await t.test('stock reductions and reservations serialize on the lot balance', async () => {
      const request = await newRequest();
      const lot = await newLot();
      const key = randomUUID();
      const reduce = (version) => send(event, coordinatorToken, {
        method: 'PATCH', resource: 'stock-lots', requestId: lot.id, key,
        body: { version, receivedQuantity: 3, reason: 'Recounted stock' },
      });
      const [reserved, reduced] = await Promise.all([assign(request, lot), reduce(lot.version)]);
      if (reserved.status === 201) {
        assert.equal(reduced.status, 409);
        assert.equal((await reduced.json()).code, 'STALE_VERSION');
        const blocked = await reduce(lot.version + 1);
        assert.equal(blocked.status, 409);
        assert.deepEqual((await blocked.json()).details, { minimumReceivedQuantity: 5 });
        assert.equal((await operations.db.query(
          'SELECT 1 FROM idempotency_record WHERE operation_key = $1', [key],
        )).rowCount, 0);
      } else {
        assert.equal(reduced.status, 200, await reduced.clone().text());
        assert.equal(reserved.status, 409);
        assert.deepEqual((await reserved.json()).details, { availableQuantity: 3 });
      }
      const detail = await send(event, coordinatorToken, { resource: 'stock-lots', requestId: lot.id });
      const { receivedQuantity, reservedQuantity, availableQuantity } = await detail.json();
      assert.deepEqual([receivedQuantity, reservedQuantity, availableQuantity],
        reserved.status === 201 ? [8, 5, 3] : [3, 0, 3]);
    });

    await t.test('audit failure rolls back reservation, request version, assignment and operation key', async () => {
      const request = await newRequest();
      const lot = await newLot();
      const key = randomUUID();
      await operations.db.query(`
        CREATE FUNCTION reject_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          RAISE EXCEPTION 'test audit failure';
        END; $$;
        CREATE TRIGGER reject_assignment_audit BEFORE INSERT ON audit_entry FOR EACH ROW
          WHEN (NEW.operation = 'assignment.create') EXECUTE FUNCTION reject_assignment_audit();
      `);
      try {
        assert.equal((await assign(request, lot, { key })).status, 500);
        assert.deepEqual(await balance(lot), { reserved: 0, available: 8, version: 1 });
        assert.equal((await operations.db.query('SELECT version FROM assistance_request WHERE id = $1',
          [request.id])).rows[0].version, request.version);
        assert.equal((await operations.db.query('SELECT 1 FROM assignment WHERE stock_lot_id = $1', [lot.id])).rowCount, 0);
        assert.equal((await operations.db.query('SELECT 1 FROM idempotency_record WHERE operation_key = $1', [key])).rowCount, 0);
      } finally {
        await operations.db.query('DROP TRIGGER reject_assignment_audit ON audit_entry; DROP FUNCTION reject_assignment_audit()');
      }
      assert.equal((await assign(request, lot, { key })).status, 201);
    });

    await t.test('a retryable database failure starts a fresh reservation with the same key', async () => {
      const request = await newRequest();
      const lot = await newLot();
      const key = randomUUID();
      await operations.db.query(`
        CREATE SEQUENCE reservation_attempts;
        CREATE FUNCTION retry_assignment_audit() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF nextval('reservation_attempts') = 1 THEN
            RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'test serialization failure';
          END IF;
          RETURN NEW;
        END; $$;
        CREATE TRIGGER retry_assignment_audit BEFORE INSERT ON audit_entry FOR EACH ROW
          WHEN (NEW.operation = 'assignment.create') EXECUTE FUNCTION retry_assignment_audit();
      `);
      try {
        const response = await assign(request, lot, { key });
        assert.equal(response.status, 201, await response.clone().text());
        assert.equal((await operations.db.query('SELECT last_value FROM reservation_attempts')).rows[0].last_value, '2');
        assert.deepEqual(await balance(lot), { reserved: 5, available: 3, version: 2 });
        assert.equal((await operations.db.query('SELECT 1 FROM assignment WHERE stock_lot_id = $1', [lot.id])).rowCount, 1);
      } finally {
        await operations.db.query(`DROP TRIGGER retry_assignment_audit ON audit_entry;
          DROP FUNCTION retry_assignment_audit(); DROP SEQUENCE reservation_attempts`);
      }
    });

    await t.test('ranks nearby eligible stock and preserves manual reservation during a Matching outage', async () => {
      const category = 'matching-water';
      await operations.db.query('INSERT INTO category (code, unit) VALUES ($1, $2)', [category, validReport.unit]);
      const request = await newRequest(true, { ...validReport, category });
      const args = { requestId: request.id, action: 'matches' };
      const suggestions = () => send(event, coordinatorToken, args);
      assert.equal((await send(event, undefined, args)).status, 401);
      assert.equal((await send(event, ownerToken, args)).status, 403);
      assert.equal((await send(anotherEvent, coordinatorToken, args)).status, 404);
      assert.equal((await send(event, coordinatorToken, { ...args, requestId: (await newRequest(false)).id })).status, 409);
      assert.deepEqual(await (await suggestions()).json(), {
        requestVersion: request.version, allocatableQuantity: 8, policyVersion: null, candidates: [],
      });

      async function seedLot(longitudeOffset, quantity, eventId = event, lotCategory = category) {
        const { rows } = await operations.db.query(
          `INSERT INTO stock_lot (event_id, category_code, unit, received_quantity, location)
           VALUES ($1, $2, 'cases', $3, ST_Point($4, $5, 4326)::geography) RETURNING id`,
          [eventId, lotCategory, quantity, validReport.location.longitude + longitudeOffset, validReport.location.latitude],
        );
        return rows[0];
      }

      const far = await seedLot(0.055, 8);
      const near = await seedLot(0.018, 3);
      await seedLot(0, 0);
      await seedLot(0, 10, anotherEvent);
      await seedLot(0, 10, event, validReport.category);
      await seedLot(0.3, 10);

      const response = await suggestions();
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const snapshot = await response.json();
      assert.equal(snapshot.policyVersion, 'distance-first-v1');
      assert.equal(snapshot.requestVersion, request.version);
      assert.equal(snapshot.allocatableQuantity, 8);
      assert.deepEqual(snapshot.candidates.map(({ lotId, distanceMetres, ...coverage }) => {
        assert.ok(distanceMetres > 0);
        return { lotId, ...coverage };
      }), [
        { lotId: near.id, availableQuantity: 3, coveredQuantity: 3,
          explanation: 'Covers 3 of 8 needed. Ranked by distance, then coverage.' },
        { lotId: far.id, availableQuantity: 8, coveredQuantity: 8,
          explanation: 'Covers 8 of 8 needed. Ranked by distance, then coverage.' },
      ]);
      assert.ok(snapshot.candidates[0].distanceMetres < snapshot.candidates[1].distanceMetres);

      const reserved = await assign(request, near, { body: { quantity: 2 } });
      assert.equal(reserved.status, 201, await reserved.clone().text());
      const updated = await reserved.json();
      const afterReservation = await (await suggestions()).json();
      assert.equal(afterReservation.requestVersion, updated.requestVersion);
      assert.equal(afterReservation.allocatableQuantity, 6);
      assert.deepEqual(afterReservation.candidates.map(({ availableQuantity, coveredQuantity }) =>
        [availableQuantity, coveredQuantity]), [[1, 1], [8, 6]]);

      await operations.db.query(
        `INSERT INTO stock_lot (event_id, category_code, unit, received_quantity, location)
         SELECT $1, $2, 'cases', 1, ST_Point($3, $4, 4326)::geography FROM generate_series(1, 100)`,
        [event, category, validReport.location.longitude, validReport.location.latitude],
      );
      const bounded = await (await suggestions()).json();
      const lotIds = bounded.candidates.map(({ lotId }) => lotId);
      assert.equal(lotIds.length, 100);
      assert.deepEqual(lotIds, [...lotIds].sort());
      assert.ok(!lotIds.includes(near.id) && !lotIds.includes(far.id));

      const rankUrl = new URL('/internal/matching/rank', matchingApp.url);
      assert.equal((await httpFetch(rankUrl, { method: 'POST' })).status, 404);
      assert.equal((await httpFetch(rankUrl, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-matching-key': process.env.MATCHING_INTERNAL_KEY },
        body: JSON.stringify({ allocatableQuantity: 8, candidates: Array(101).fill({}) }),
      })).status, 400);

      await matchingApp.close();
      assert.equal((await suggestions()).status, 503);
      const stock = await send(event, coordinatorToken, { resource: 'stock-lots', requestId: far.id });
      assert.equal(stock.status, 200);
      assert.equal((await assign(request, far)).status, 409);
      const manual = await assign({ ...request, version: updated.requestVersion }, far, { body: { quantity: 6 } });
      assert.equal(manual.status, 201, await manual.clone().text());
      assert.equal((await manual.json()).allocatableQuantity, 0);
      assert.deepEqual(await (await suggestions()).json(), {
        requestVersion: updated.requestVersion + 1, allocatableQuantity: 0, policyVersion: null, candidates: [],
      });
    });
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
