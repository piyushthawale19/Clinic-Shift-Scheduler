// PostgreSQL connection pool — single shared instance for the application.
import pg from "pg";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const useSsl =
  process.env.DATABASE_URL?.includes("sslmode=") ||
  process.env.DATABASE_URL?.includes("render.com") ||
  process.env.NODE_ENV === "production";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
});

// Surface connection errors at the pool level rather than silently dropping them.
pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
  process.exit(1);
});
