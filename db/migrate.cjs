const { readFile } = require('node:fs/promises');
const { join } = require('node:path');
const { Client } = require('pg');

async function migrate(connectionString, path) {
  if (!connectionString) {
    throw new Error('Set both DATABASE_URL and ACCESS_DATABASE_URL');
  }
  const sql = await readFile(join(__dirname, 'migrations', path), 'utf8');
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
  } finally {
    await client.end();
  }
}

async function main() {
  const operations = process.env.DATABASE_URL;
  const access = process.env.ACCESS_DATABASE_URL;
  if (!operations || !access || operations === access) {
    throw new Error('Configure separate DATABASE_URL and ACCESS_DATABASE_URL connections');
  }
  await migrate(operations, 'operations/001-resident-requests.sql');
  await migrate(operations, 'operations/002-request-review.sql');
  await migrate(access, 'access/001-resident-membership.sql');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
