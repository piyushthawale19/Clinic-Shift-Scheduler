// PostgreSQL connection pool — single shared instance for the application.
import pg from "pg";
import { config } from "../config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  ...(process.env.NODE_ENV === "production" && {
    ssl: { rejectUnauthorized: false },
  }),
});

// Surface connection errors at the pool level rather than silently dropping them.
pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
  process.exit(1);
});
