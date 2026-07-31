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

  console.log("\n=== Importing staff.csv ===");
  const staffCsv = fs.readFileSync(
    path.join(PROJECT_ROOT, "staff.csv"),
    "utf-8"
  );
  const staffResult = await importStaff(staffCsv, null);
  const sr = staffResult.result;
  console.log(
    `  Accepted: ${sr.accepted.length}, Auto-corrected: ${sr.autoCorrected.length}, Merged: ${sr.merged.length}, Rejected: ${sr.rejected.length}`
  );
  console.log(`  Report ID: ${staffResult.reportId}`);

  console.log("\n=== Importing shifts.csv ===");
  const shiftsCsv = fs.readFileSync(
    path.join(PROJECT_ROOT, "shifts.csv"),
    "utf-8"
  );
  const shiftsResult = await importShifts(shiftsCsv, null);
  const shr = shiftsResult.result;
  console.log(
    `  Accepted: ${shr.accepted.length}, Auto-corrected: ${shr.autoCorrected.length}, Merged: ${shr.merged.length}, Rejected: ${shr.rejected.length}`
  );
  console.log(`  Report ID: ${shiftsResult.reportId}`);

  console.log("\n=== Seed complete ===");
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  });
