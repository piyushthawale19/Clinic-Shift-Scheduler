// Migration runner — applies SQL migration files in order, tracking which have been run.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "migrations");

export async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    // Ensure the migrations tracking table exists before checking applied migrations.
    await client.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const { rows: applied } = await client.query(
      "SELECT name FROM _migrations ORDER BY name"
    );
    const appliedSet = new Set(applied.map((r) => r.name));

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const file of files) {
      if (appliedSet.has(file)) {
        console.log(`  ✓ ${file} (already applied)`);
        continue;
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [
          file,
        ]);
        await client.query("COMMIT");
        console.log(`  ✓ ${file} (applied)`);
      } catch (err) {
        await client.query("ROLLBACK");
        console.error(`  ✗ ${file} (failed):`, err);
        throw err;
      }
    }

    console.log("Migrations complete.");
  } finally {
    client.release();
  }
}

// Allow running directly via `tsx src/db/migrate.ts`
if (process.argv[1]?.includes("migrate")) {
  runMigrations()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
