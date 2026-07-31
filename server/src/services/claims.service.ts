// Claims service — handles shift claiming/unclaiming with transactional safety and row-level locking.
// This is the most critical business logic module in the application.
import { pool } from "../db/pool.js";
import {
  ConflictError,
  ValidationError,
  NotFoundError,
} from "../utils/errors.js";

interface ShiftTimeInfo {
  date: string | Date;
  start_time: string;
  end_time: string;
  is_overnight: boolean;
}

/**
 * Claims a shift for a staff member. All validation happens inside a single
 * database transaction with row-level locking to prevent race conditions.
 *
 * The lock order is: shift row first (FOR UPDATE), then read assignments.
 * This ensures two concurrent claims on the same shift are serialized.
 */
export async function claimShift(
  shiftId: number,
  userId: number,
  userProfession: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Step 1: Lock the shift row to prevent concurrent modifications.
    const { rows: shiftRows } = await client.query(
      `SELECT id, date, start_time, end_time, is_overnight,
              req_doctors, req_nurses, req_receptionists
       FROM shifts WHERE id = $1 FOR UPDATE`,
      [shiftId]
    );
    if (shiftRows.length === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("Shift");
    }
    const shift = shiftRows[0];

    // Step 2: Check profession capacity — count current claims by this profession.
    const reqColumn = getRequirementColumn(userProfession);
    const maxAllowed: number = shift[reqColumn];

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM shift_assignments sa
       JOIN users u ON sa.user_id = u.id
       WHERE sa.shift_id = $1 AND u.profession = $2`,
      [shiftId, userProfession]
    );
    const currentCount: number = countRows[0].cnt;

    if (currentCount >= maxAllowed) {
      await client.query("ROLLBACK");
      throw new ConflictError(
        `This shift already has the maximum number of ${userProfession}s (${maxAllowed}).`,
        { required: maxAllowed, current: currentCount }
      );
    }

    // Step 3: Check for time overlap with the user's other claimed shifts.
    await checkOverlap(client, userId, shift, shiftId);

    // Step 4: Insert the assignment. The unique constraint (shift_id, user_id)
    // is the final DB-level safety net against double-claims.
    try {
      await client.query(
        "INSERT INTO shift_assignments (shift_id, user_id) VALUES ($1, $2)",
        [shiftId, userId]
      );
    } catch (err: unknown) {
      await client.query("ROLLBACK");
      if ((err as { code?: string }).code === "23505") {
        throw new ConflictError("You have already claimed this shift.");
      }
      throw err;
    }

    await client.query("COMMIT");
  } catch (err) {
    // Ensure rollback on any unexpected error.
    try {
      await client.query("ROLLBACK");
    } catch {
      // Ignore rollback errors — the original error is more important.
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Unclaims a shift for a staff member.
 * Locks the shift row first to ensure consistency with concurrent claim operations.
 */
export async function unclaimShift(
  shiftId: number,
  userId: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Lock shift row for consistency with concurrent operations.
    const { rows } = await client.query(
      "SELECT id FROM shifts WHERE id = $1 FOR UPDATE",
      [shiftId]
    );
    if (rows.length === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("Shift");
    }

    const { rowCount } = await client.query(
      "DELETE FROM shift_assignments WHERE shift_id = $1 AND user_id = $2",
      [shiftId, userId]
    );

    if (rowCount === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("Assignment");
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow rollback errors
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Manager assigns a specific staff member to a shift.
 * Uses the same validation as claimShift — profession capacity + overlap check.
 */
export async function assignStaff(
  shiftId: number,
  staffUserId: number
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Get the staff member's profession.
    const { rows: userRows } = await client.query(
      "SELECT profession FROM users WHERE id = $1 AND role = 'staff'",
      [staffUserId]
    );
    if (userRows.length === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("Staff member");
    }
    const profession = userRows[0].profession;

    // Lock shift row.
    const { rows: shiftRows } = await client.query(
      `SELECT id, date, start_time, end_time, is_overnight,
              req_doctors, req_nurses, req_receptionists
       FROM shifts WHERE id = $1 FOR UPDATE`,
      [shiftId]
    );
    if (shiftRows.length === 0) {
      await client.query("ROLLBACK");
      throw new NotFoundError("Shift");
    }
    const shift = shiftRows[0];

    // Check capacity.
    const reqColumn = getRequirementColumn(profession);
    const maxAllowed: number = shift[reqColumn];

    const { rows: countRows } = await client.query(
      `SELECT COUNT(*)::int AS cnt
       FROM shift_assignments sa
       JOIN users u ON sa.user_id = u.id
       WHERE sa.shift_id = $1 AND u.profession = $2`,
      [shiftId, profession]
    );

    if (countRows[0].cnt >= maxAllowed) {
      await client.query("ROLLBACK");
      throw new ConflictError(
        `This shift already has the maximum number of ${profession}s (${maxAllowed}).`
      );
    }

    // Check overlap.
    await checkOverlap(client, staffUserId, shift, shiftId);

    // Insert.
    try {
      await client.query(
        "INSERT INTO shift_assignments (shift_id, user_id) VALUES ($1, $2)",
        [shiftId, staffUserId]
      );
    } catch (err: unknown) {
      if ((err as { code?: string }).code === "23505") {
        await client.query("ROLLBACK");
        throw new ConflictError("This staff member is already assigned to this shift.");
      }
      throw err;
    }

    await client.query("COMMIT");
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Swallow
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Re-validates all existing claims on a shift after it has been edited.
 * Called inside the shift edit transaction. If any claim now overlaps with
 * the staff member's other shifts, returns the list of conflicts.
 *
 * This does NOT silently drop claims — it returns conflicts so the caller
 * can reject the edit with a clear error message.
 */
export async function revalidateShiftClaims(
  client: import("pg").PoolClient,
  shiftId: number,
  updatedShift: ShiftTimeInfo
): Promise<Array<{ userId: number; fullName: string; reason: string }>> {
  const conflicts: Array<{ userId: number; fullName: string; reason: string }> = [];

  const { rows: assignments } = await client.query(
    `SELECT sa.user_id, u.full_name, u.profession
     FROM shift_assignments sa
     JOIN users u ON sa.user_id = u.id
     WHERE sa.shift_id = $1`,
    [shiftId]
  );

  for (const assignment of assignments) {
    // Check profession capacity with updated requirements
    // (caller passes the updated shift data, not the old one)

    // Check overlap with user's OTHER shifts (excluding this one).
    const overlapping = await findOverlappingShifts(
      client,
      assignment.user_id,
      updatedShift,
      shiftId
    );

    if (overlapping.length > 0) {
      conflicts.push({
        userId: assignment.user_id,
        fullName: assignment.full_name,
        reason: `Shift edit would create a time overlap with shift(s) on ${overlapping.map((s) => s.date).join(", ")} for ${assignment.full_name}.`,
      });
    }
  }

  return conflicts;
}

// --- Internal helpers ---

/**
 * Checks if a user's other shifts overlap with the given shift's time window.
 * Throws ConflictError if overlap is detected.
 * Must be called within a transaction that has already locked the target shift.
 */
async function checkOverlap(
  client: import("pg").PoolClient,
  userId: number,
  shift: ShiftTimeInfo & { id: number },
  excludeShiftId: number
): Promise<void> {
  const overlapping = await findOverlappingShifts(client, userId, shift, excludeShiftId);

  if (overlapping.length > 0) {
    throw new ConflictError(
      `This shift overlaps with another shift you've claimed (${overlapping[0].date} ${overlapping[0].start_time}–${overlapping[0].end_time}).`,
      { overlappingShifts: overlapping.map((s) => s.id) }
    );
  }
}

/**
 * Finds all shifts assigned to a user that overlap with the given time window.
 *
 * Overlap logic handles four cases:
 * 1. Both shifts are same-day (non-overnight): standard interval overlap on the same date
 * 2. New shift is overnight: spans two dates, check both
 * 3. Existing shift is overnight: spans two dates
 * 4. Both overnight: could overlap on the boundary date
 *
 * Two time intervals [s1,e1] and [s2,e2] overlap if s1 < e2 AND s2 < e1.
 */
async function findOverlappingShifts(
  client: import("pg").PoolClient,
  userId: number,
  shift: ShiftTimeInfo,
  excludeShiftId: number
): Promise<Array<{ id: number; date: string; start_time: string; end_time: string }>> {
  // Get all shifts the user is assigned to (excluding the target shift).
  const { rows: userShifts } = await client.query(
    `SELECT s.id, s.date::text AS date, s.start_time::text AS start_time,
            s.end_time::text AS end_time, s.is_overnight
     FROM shift_assignments sa
     JOIN shifts s ON sa.shift_id = s.id
     WHERE sa.user_id = $1 AND s.id != $2`,
    [userId, excludeShiftId]
  );

  const overlapping: Array<{
    id: number;
    date: string;
    start_time: string;
    end_time: string;
  }> = [];

  // Convert the new shift into absolute datetime ranges for comparison.
  const newStart = toAbsoluteMinutes(shift.date, shift.start_time);
  const newEnd = shift.is_overnight
    ? toAbsoluteMinutes(nextDate(shift.date), shift.end_time)
    : toAbsoluteMinutes(shift.date, shift.end_time);

  for (const existing of userShifts) {
    const existStart = toAbsoluteMinutes(existing.date, existing.start_time);
    const existEnd = existing.is_overnight
      ? toAbsoluteMinutes(nextDate(existing.date), existing.end_time)
      : toAbsoluteMinutes(existing.date, existing.end_time);

    // Standard interval overlap check: [s1, e1) overlaps [s2, e2) iff s1 < e2 AND s2 < e1
    if (newStart < existEnd && existStart < newEnd) {
      overlapping.push(existing);
    }
  }

  return overlapping;
}

/** Converts a date (YYYY-MM-DD) + time (HH:MM) to total minutes since epoch for comparison. */
function toAbsoluteMinutes(dateObjOrStr: string | Date, timeStr: string): number {
  const dateStr = typeof dateObjOrStr === "string" ? dateObjOrStr : dateObjOrStr.toISOString().slice(0, 10);
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  const [h, min] = timeStr.split(":").map(Number) as [number, number];
  // Using a simple formula — exact epoch doesn't matter, only relative ordering does.
  return ((y * 366 + m * 31 + d) * 24 + h) * 60 + min;
}

/** Returns the next calendar date as YYYY-MM-DD. */
function nextDate(dateObjOrStr: string | Date): string {
  const d = new Date(dateObjOrStr);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Maps a profession to its requirement column name on the shifts table. */
function getRequirementColumn(
  profession: string
): "req_doctors" | "req_nurses" | "req_receptionists" {
  switch (profession) {
    case "doctor":
      return "req_doctors";
    case "nurse":
      return "req_nurses";
    case "receptionist":
      return "req_receptionists";
    default:
      throw new ValidationError(`Unknown profession: ${profession}`);
  }
}
