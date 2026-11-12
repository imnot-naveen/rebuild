require('reflect-metadata');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { NestFactory } = require('@nestjs/core');
const { Client } = require('pg');
const { AppModule } = require('../dist/app.module');

test('GET /health returns 200 and the API status', async () => {
  const app = await NestFactory.create(AppModule, { logger: false });

  try {
    await app.listen(0, '127.0.0.1');
    const response = await fetch(`${await app.getUrl()}/health`, {
      signal: AbortSignal.timeout(5000),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok' });
  } finally {
    await app.close();
  }
});

test('PostGIS stores and reads a geography point', async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, 'Set DATABASE_URL or copy .env.example to .env');

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    statement_timeout: 5000,
  });

  try {
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE rebuild_smoke (
        id integer PRIMARY KEY,
        location geography(Point, 4326) NOT NULL
      )
    `);
    const location = 'SRID=4326;POINT(79.86 6.93)';
    await client.query(
      'INSERT INTO rebuild_smoke (id, location) VALUES ($1, $2::geography)',
      [1, location],
    );
    const { rows } = await client.query(
      `SELECT id, ST_DWithin(location, $2::geography, 1) AS nearby
       FROM rebuild_smoke WHERE id = $1`,
      [1, location],
    );

    assert.deepEqual(rows, [{ id: 1, nearby: true }]);
  } finally {
    await client.end();
  }
});
