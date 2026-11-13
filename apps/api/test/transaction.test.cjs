const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Pool } = require("pg");

test("PostgreSQL commits and rolls back writes", async () => {
  const connectionString = process.env.DATABASE_URL;
  assert.ok(connectionString, "Set DATABASE_URL or copy .env.example to .env");

  const pool = new Pool({ connectionString, connectionTimeoutMillis: 5000 });

  try {
    const client = await pool.connect();

    try {
      await client.query(`
        CREATE TEMP TABLE transaction_smoke (
          id integer PRIMARY KEY
        )
      `);

      await client.query("BEGIN");
      await client.query("INSERT INTO transaction_smoke (id) VALUES ($1)", [1]);
      await client.query("COMMIT");
      const afterCommitResult = await client.query(
        "SELECT id FROM transaction_smoke ORDER BY id",
      );
      assert.deepEqual(afterCommitResult.rows, [{ id: 1 }]);

      await client.query("BEGIN");
      await client.query("INSERT INTO transaction_smoke (id) VALUES ($1)", [2]);
      await client.query("ROLLBACK");
      const afterRollbackResult = await client.query(
        "SELECT id FROM transaction_smoke ORDER BY id",
      );
      assert.deepEqual(afterRollbackResult.rows, [{ id: 1 }]);
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
});
