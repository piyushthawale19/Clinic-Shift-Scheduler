// Seed script — runs migrations, creates the manager account, and imports CSV files.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "./pool.js";
import { runMigrations } from "./migrate.js";
import { hashPassword } from "../services/auth.service.js";
import { importStaff, importShifts } from "../importer/import.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../../");

async function seed(): Promise<void> {
  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is missing");
    }

    const client = await pool.connect();
    let dbHost = "unknown";
    let dbName = "unknown";
    try {
      const { rows: dbInfo } = await client.query("SELECT current_database() AS db_name");
      dbName = dbInfo[0]?.db_name || "unknown";
      const dbUrl = new URL(process.env.DATABASE_URL);
      dbHost = dbUrl.hostname;
    } catch {
      try {
        dbHost = process.env.DATABASE_URL.split("@")[1]?.split("/")[0]?.split(":")[0] || "unknown";
      } catch {}
    }
    client.release();

    console.log(`Connected to Database Host: ${dbHost}, Database Name: ${dbName}`);

    console.log("=== Running migrations ===");
    await runMigrations();

    console.log("\n=== Seeding manager account ===");
    const managerPasswordHash = await hashPassword("Manager123!");

    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, profession)
       VALUES ($1, $2, $3, 'manager', NULL)
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         updated_at = NOW()`,
      ["admin@clinic.test", managerPasswordHash, "Clinic Manager"]
    );
    console.log("  ✓ Manager: admin@clinic.test / Manager123!");

    console.log("\n=== Seeding staff account ===");
    const staffPasswordHash = await hashPassword("Staff123!");
    await pool.query(
      `INSERT INTO users (email, password_hash, full_name, role, profession, staff_id)
       VALUES ($1, $2, $3, 'staff', 'doctor', '121')
       ON CONFLICT (email) DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         updated_at = NOW()`,
      ["marcus.whitfield@clinicmail.test", staffPasswordHash, "Marcus Whitfield"]
    );
    console.log("  ✓ Staff: marcus.whitfield@clinicmail.test / Staff123!");

    console.log("\n=== Importing staff.csv ===");
    const staffCsvPath = path.join(PROJECT_ROOT, "staff.csv");
    if (!fs.existsSync(staffCsvPath)) {
      console.warn(`Warning: staff.csv not found at ${staffCsvPath}. Skipping CSV import.`);
    } else {
      const staffCsv = fs.readFileSync(staffCsvPath, "utf-8");
      const staffResult = await importStaff(staffCsv, null);
      const sr = staffResult.result;
      console.log(
        `  Accepted: ${sr.accepted.length}, Auto-corrected: ${sr.autoCorrected.length}, Merged: ${sr.merged.length}, Rejected: ${sr.rejected.length}`
      );
      console.log(`  Report ID: ${staffResult.reportId}`);
    }

    console.log("\n=== Importing shifts.csv ===");
    const shiftsCsvPath = path.join(PROJECT_ROOT, "shifts.csv");
    if (!fs.existsSync(shiftsCsvPath)) {
      console.warn(`Warning: shifts.csv not found at ${shiftsCsvPath}. Skipping CSV import.`);
    } else {
      const shiftsCsv = fs.readFileSync(shiftsCsvPath, "utf-8");
      const shiftsResult = await importShifts(shiftsCsv, null);
      const shr = shiftsResult.result;
      console.log(
        `  Accepted: ${shr.accepted.length}, Auto-corrected: ${shr.autoCorrected.length}, Merged: ${shr.merged.length}, Rejected: ${shr.rejected.length}`
      );
      console.log(`  Report ID: ${shiftsResult.reportId}`);
    }

    console.log("\n=== Seed complete ===");
    console.log("Seed status: SUCCESS");
  } catch (err) {
    console.error("Seed status: FAILED", err);
    process.exit(1);
  }
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
