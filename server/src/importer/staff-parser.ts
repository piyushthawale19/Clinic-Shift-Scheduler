// Staff CSV row parser — pure function that validates, normalizes, deduplicates, and reports on staff rows.
import {
  normalizeProfession,
  isValidEmail,
  isPlaceholderName,
  normalizeName,
} from "./normalizers.js";
import type { ImportEntry, StaffRow, ParseResult } from "./types.js";

interface RawStaffRow {
  staff_id?: string;
  full_name?: string;
  role?: string;
  email?: string;
}

/**
 * Parses an array of raw CSV row objects into categorized import results.
 * Pure function — no database access. All decisions (accept/reject/merge/auto-correct)
 * are made here with full reasoning attached to each entry.
 */
export function parseStaffRows(rows: RawStaffRow[]): ParseResult<StaffRow> {
  const result: ParseResult<StaffRow> = {
    accepted: [],
    rejected: [],
    merged: [],
    autoCorrected: [],
  };

  // Track seen staff by ID and by email for duplicate/conflict detection.
  const seenById = new Map<string, { row: StaffRow; rowNumber: number }>();
  const seenByEmail = new Map<string, { staffId: string; rowNumber: number }>();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const rowNumber = i + 2; // +2 because row 1 is header, data starts at 2
    const originalData = { ...raw } as Record<string, string>;
    const problems: string[] = [];
    let needsCorrection = false;

    // --- Validate required fields ---
    const staffId = raw.staff_id?.trim();
    if (!staffId) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: ["Missing staff_id"],
        details: "Row rejected: staff_id is required but was empty.",
      });
      continue;
    }

    const rawName = raw.full_name?.trim() ?? "";
    if (!rawName) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: ["Missing full_name"],
        details: "Row rejected: full_name is required but was empty.",
      });
      continue;
    }

    // --- Check for placeholder names ---
    if (isPlaceholderName(rawName)) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: ["Placeholder/junk name detected"],
        details: `Row rejected: "${rawName}" appears to be a placeholder name, not a real staff member.`,
      });
      continue;
    }

    // --- Normalize name ---
    const fullName = normalizeName(rawName);
    if (fullName !== rawName) {
      problems.push(`Name normalized from "${rawName}" to "${fullName}"`);
      needsCorrection = true;
    }

    // --- Validate and normalize profession ---
    const rawRole = raw.role ?? "";
    const profession = normalizeProfession(rawRole);
    if (!profession) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [`Unrecognized profession: "${rawRole.trim()}"`],
        details: `Row rejected: profession "${rawRole.trim()}" is not one of doctor, nurse, or receptionist (or any known alias).`,
      });
      continue;
    }
    if (profession !== rawRole.trim().toLowerCase()) {
      problems.push(
        `Profession normalized from "${rawRole.trim()}" to "${profession}"`
      );
      needsCorrection = true;
    }

    // --- Validate email ---
    const rawEmail = raw.email?.trim() ?? "";
    if (!rawEmail) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: ["Missing email"],
        details: "Row rejected: email is required but was empty.",
      });
      continue;
    }
    if (!isValidEmail(rawEmail)) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [`Malformed email: "${rawEmail}"`],
        details: `Row rejected: email "${rawEmail}" is not a valid email address.`,
      });
      continue;
    }
    const email = rawEmail.toLowerCase();

    // --- Duplicate / conflict detection ---
    const existing = seenById.get(staffId);
    if (existing) {
      // Same staff_id seen before — check if it's an exact duplicate or a conflict
      if (
        existing.row.fullName === fullName &&
        existing.row.email === email &&
        existing.row.profession === profession
      ) {
        result.merged.push({
          rowNumber,
          originalData,
          action: "merged",
          problems: ["Exact duplicate row"],
          details: `Row merged: identical to row ${existing.rowNumber} (same staff_id, name, email, profession). Kept the first occurrence.`,
        });
        continue;
      } else {
        result.rejected.push({
          rowNumber,
          originalData,
          action: "rejected",
          problems: [
            `Conflicting staff_id: "${staffId}" already used by "${existing.row.fullName}" (row ${existing.rowNumber})`,
          ],
          details: `Row rejected: staff_id "${staffId}" is already assigned to "${existing.row.fullName}" (row ${existing.rowNumber}) with different data. Cannot import two different people under the same ID.`,
        });
        continue;
      }
    }

    // Check if same email already imported under a different staff_id
    const existingByEmail = seenByEmail.get(email);
    if (existingByEmail) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [
          `Duplicate email: "${email}" already used by staff_id "${existingByEmail.staffId}" (row ${existingByEmail.rowNumber})`,
        ],
        details: `Row rejected: email "${email}" is already assigned to staff_id "${existingByEmail.staffId}" (row ${existingByEmail.rowNumber}). Same person may appear under two different IDs — keeping the first occurrence.`,
      });
      continue;
    }

    // --- All checks passed ---
    const parsed: StaffRow = { staffId, fullName, profession, email };

    seenById.set(staffId, { row: parsed, rowNumber });
    seenByEmail.set(email, { staffId, rowNumber });

    const entry: ImportEntry<StaffRow> = {
      rowNumber,
      originalData,
      action: needsCorrection ? "auto_corrected" : "accepted",
      problems,
      details: needsCorrection
        ? `Row auto-corrected: ${problems.join("; ")}.`
        : "Row accepted without changes.",
      parsedData: parsed,
      correctedData: needsCorrection ? parsed : undefined,
    };

    if (needsCorrection) {
      result.autoCorrected.push(entry);
    } else {
      result.accepted.push(entry);
    }
  }

  return result;
}
