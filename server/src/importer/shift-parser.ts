// Shift CSV row parser — pure function that validates, normalizes, deduplicates, and reports on shift rows.
import {
  parseDate,
  parseTime,
  isOvernightShift,
  parseRequirements,
} from "./normalizers.js";
import type { ImportEntry, ShiftRow, ParseResult } from "./types.js";

interface RawShiftRow {
  shift_id?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
  requirements?: string;
}

/**
 * Parses an array of raw CSV row objects into categorized import results.
 * Pure function — no database access.
 */
export function parseShiftRows(rows: RawShiftRow[]): ParseResult<ShiftRow> {
  const result: ParseResult<ShiftRow> = {
    accepted: [],
    rejected: [],
    merged: [],
    autoCorrected: [],
  };

  // Track seen shifts by ID for duplicate detection.
  const seenById = new Map<
    string,
    { row: ShiftRow; rowNumber: number; rawReqs: string }
  >();

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const rowNumber = i + 2;
    const originalData = { ...raw } as Record<string, string>;
    const problems: string[] = [];
    let needsCorrection = false;

    // --- Validate shift_id ---
    const shiftId = raw.shift_id?.trim();
    if (!shiftId) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: ["Missing shift_id"],
        details: "Row rejected: shift_id is required but was empty.",
      });
      continue;
    }

    // --- Parse and validate date ---
    const rawDate = raw.date ?? "";
    const parsedDate = parseDate(rawDate);
    if (!parsedDate) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [`Invalid or impossible date: "${rawDate.trim()}"`],
        details: `Row rejected: date "${rawDate.trim()}" could not be parsed or represents an impossible calendar date (e.g., Feb 30).`,
      });
      continue;
    }
    if (parsedDate !== rawDate.trim()) {
      problems.push(`Date normalized from "${rawDate.trim()}" to "${parsedDate}"`);
      needsCorrection = true;
    }

    // --- Parse and validate start_time ---
    const rawStart = raw.start_time ?? "";
    const startTime = parseTime(rawStart);
    if (!startTime) {
      const reason = rawStart.trim()
        ? `Malformed start_time: "${rawStart.trim()}"`
        : "Missing start_time";
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [reason],
        details: `Row rejected: ${reason}. Start time must be in HH:MM format.`,
      });
      continue;
    }

    // --- Parse and validate end_time ---
    const rawEnd = raw.end_time ?? "";
    const endTime = parseTime(rawEnd);
    if (!endTime) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [`Malformed end_time: "${rawEnd.trim()}"`],
        details: `Row rejected: end_time "${rawEnd.trim()}" could not be parsed. End time must be in HH:MM format.`,
      });
      continue;
    }

    // --- Check for zero-duration shift (start == end) ---
    if (startTime === endTime) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [
          `Zero-duration shift: start_time equals end_time ("${startTime}")`,
        ],
        details: `Row rejected: start_time and end_time are both "${startTime}". A shift with zero duration is invalid. (If this was meant to be a 24-hour shift, it should be represented differently.)`,
      });
      continue;
    }

    const isOvernight = isOvernightShift(startTime, endTime);

    // --- Parse requirements ---
    const rawReqs = raw.requirements ?? "";
    const reqs = parseRequirements(rawReqs);
    if (!reqs) {
      result.rejected.push({
        rowNumber,
        originalData,
        action: "rejected",
        problems: [`Unparseable requirements: "${rawReqs.trim()}"`],
        details: `Row rejected: requirements field "${rawReqs.trim()}" could not be parsed as either structured (nurses=2;doctors=1) or free text format.`,
      });
      continue;
    }

    // Check if requirements were parsed from free text or had corrections
    const isStructured = /\w+=\d+/.test(rawReqs.trim());
    if (!isStructured) {
      problems.push(
        `Requirements parsed from free text "${rawReqs.trim()}" to doctors=${reqs.doctors}, nurses=${reqs.nurses}, receptionists=${reqs.receptionists}`
      );
      needsCorrection = true;
    }

    // --- Duplicate detection ---
    const existing = seenById.get(shiftId);
    if (existing) {
      // Check if it's an exact duplicate (all fields match)
      if (
        existing.row.date === parsedDate &&
        existing.row.startTime === startTime &&
        existing.row.endTime === endTime &&
        existing.rawReqs === rawReqs.trim()
      ) {
        result.merged.push({
          rowNumber,
          originalData,
          action: "merged",
          problems: ["Exact duplicate row"],
          details: `Row merged: identical to row ${existing.rowNumber} (same shift_id and all fields). Kept the first occurrence.`,
        });
        continue;
      } else {
        // Conflicting shift_id — different data under the same ID.
        result.rejected.push({
          rowNumber,
          originalData,
          action: "rejected",
          problems: [
            `Conflicting shift_id: "${shiftId}" already exists with different data (row ${existing.rowNumber})`,
          ],
          details: `Row rejected: shift_id "${shiftId}" already imported from row ${existing.rowNumber} with different time/date/requirements. Cannot import two different shifts under the same ID.`,
        });
        continue;
      }
    }

    // --- All checks passed ---
    const parsed: ShiftRow = {
      shiftId,
      date: parsedDate,
      startTime,
      endTime,
      isOvernight,
      reqDoctors: reqs.doctors,
      reqNurses: reqs.nurses,
      reqReceptionists: reqs.receptionists,
    };

    seenById.set(shiftId, { row: parsed, rowNumber, rawReqs: rawReqs.trim() });

    const entry: ImportEntry<ShiftRow> = {
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
