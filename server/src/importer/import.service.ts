// Import service — orchestrates CSV parsing and database writes for staff and shift imports.
import { parse } from "csv-parse/sync";
import { pool } from "../db/pool.js";
import { hashPassword } from "../services/auth.service.js";
import { parseStaffRows } from "./staff-parser.js";
import { parseShiftRows } from "./shift-parser.js";
import type { ParseResult, StaffRow, ShiftRow, ImportEntry } from "./types.js";

const DEFAULT_STAFF_PASSWORD = "Staff123!";

/**
 * Parses CSV text into an array of row objects.
 * Handles BOM, trims headers, and skips completely empty rows.
 */
export function parseCsvText(csvText: string): Record<string, string>[] {
  return parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
  });
}

/**
 * Full staff import pipeline: parse CSV → validate → write to DB → save report.
 * Returns the report ID for the Import Report page.
 */
export async function importStaff(
  csvText: string,
  importedBy: number | null
): Promise<{ reportId: number; result: ParseResult<StaffRow> }> {
  const rawRows = parseCsvText(csvText);
  const result = parseStaffRows(rawRows);

  const goodEntries = [...result.accepted, ...result.autoCorrected];
  const allEntries = [
    ...result.accepted,
    ...result.autoCorrected,
    ...result.merged,
    ...result.rejected,
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Insert accepted/auto-corrected staff into users table.
    // Uses ON CONFLICT to handle cases where a re-import contains already-existing staff.
    const passwordHash = await hashPassword(DEFAULT_STAFF_PASSWORD);

    for (const entry of goodEntries) {
      const staff = entry.parsedData!;
      await client.query(
        `INSERT INTO users (email, password_hash, full_name, role, profession, staff_id)
         VALUES ($1, $2, $3, 'staff', $4, $5)
         ON CONFLICT (email) DO UPDATE SET
           full_name = EXCLUDED.full_name,
           profession = EXCLUDED.profession,
           staff_id = EXCLUDED.staff_id,
           updated_at = NOW()`,
        [staff.email, passwordHash, staff.fullName, staff.profession, staff.staffId]
      );
    }

    // Save the import report.
    const { rows: reportRows } = await client.query(
      `INSERT INTO import_reports (import_type, imported_by, total_rows, accepted, rejected, auto_corrected, merged)
       VALUES ('staff', $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        importedBy,
        rawRows.length,
        result.accepted.length,
        result.rejected.length,
        result.autoCorrected.length,
        result.merged.length,
      ]
    );
    const reportId = reportRows[0].id;

    // Save individual report entries.
    for (const entry of allEntries) {
      await client.query(
        `INSERT INTO import_report_entries (report_id, row_number, original_data, action, problems, details, corrected_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reportId,
          entry.rowNumber,
          JSON.stringify(entry.originalData),
          entry.action,
          entry.problems,
          entry.details,
          entry.correctedData ? JSON.stringify(entry.correctedData) : null,
        ]
      );
    }

    await client.query("COMMIT");
    return { reportId, result };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Full shift import pipeline: parse CSV → validate → write to DB → save report.
 */
export async function importShifts(
  csvText: string,
  importedBy: number | null
): Promise<{ reportId: number; result: ParseResult<ShiftRow> }> {
  const rawRows = parseCsvText(csvText);
  const result = parseShiftRows(rawRows);

  const goodEntries = [...result.accepted, ...result.autoCorrected];
  const allEntries = [
    ...result.accepted,
    ...result.autoCorrected,
    ...result.merged,
    ...result.rejected,
  ];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const entry of goodEntries) {
      const shift = entry.parsedData!;
      // ON CONFLICT on original_csv_id — if re-importing, update rather than duplicate.
      await client.query(
        `INSERT INTO shifts (original_csv_id, date, start_time, end_time, is_overnight, req_doctors, req_nurses, req_receptionists, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING`,
        [
          shift.shiftId,
          shift.date,
          shift.startTime,
          shift.endTime,
          shift.isOvernight,
          shift.reqDoctors,
          shift.reqNurses,
          shift.reqReceptionists,
          importedBy,
        ]
      );
    }

    const { rows: reportRows } = await client.query(
      `INSERT INTO import_reports (import_type, imported_by, total_rows, accepted, rejected, auto_corrected, merged)
       VALUES ('shifts', $1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        importedBy,
        rawRows.length,
        result.accepted.length,
        result.rejected.length,
        result.autoCorrected.length,
        result.merged.length,
      ]
    );
    const reportId = reportRows[0].id;

    for (const entry of allEntries) {
      await client.query(
        `INSERT INTO import_report_entries (report_id, row_number, original_data, action, problems, details, corrected_data)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          reportId,
          entry.rowNumber,
          JSON.stringify(entry.originalData),
          entry.action,
          entry.problems,
          entry.details,
          entry.correctedData ? JSON.stringify(entry.correctedData) : null,
        ]
      );
    }

    await client.query("COMMIT");
    return { reportId, result };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
