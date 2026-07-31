// Shift routes — CRUD operations, claiming, unclaiming, and manager assignment.
import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { pool } from "../db/pool.js";
import {
  claimShift,
  unclaimShift,
  assignStaff,
  revalidateShiftClaims,
} from "../services/claims.service.js";
import { AppError, ValidationError } from "../utils/errors.js";

// Helper to safely extract a string param from Express v5's string | string[] union.
function param(req: Request, name: string): string {
  const val = req.params[name];
  return Array.isArray(val) ? val[0]! : val ?? "";
}

const router = Router();

// Get all staff members (for manager assignment dropdown).
// Must be before /:id to prevent Express from matching 'staff' as an ID.
router.get(
  "/staff/all",
  authenticate,
  requireRole("manager"),
  async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        "SELECT id, full_name, profession, email FROM users WHERE role = 'staff' ORDER BY full_name"
      );
      res.json(rows);
    } catch (err) {
      console.error("List staff error:", err);
      res.status(500).json({ error: "Failed to fetch staff" });
    }
  }
);

// List all shifts with their assignment counts and assigned staff.
router.get("/", authenticate, async (req: Request, res: Response) => {
  try {
    const { date_from, date_to } = req.query;

    let query = `
      SELECT s.*,
        COALESCE(json_agg(
          json_build_object(
            'id', sa.id,
            'userId', u.id,
            'fullName', u.full_name,
            'profession', u.profession
          ) ORDER BY sa.claimed_at
        ) FILTER (WHERE sa.id IS NOT NULL), '[]') AS assignments
      FROM shifts s
      LEFT JOIN shift_assignments sa ON s.id = sa.shift_id
      LEFT JOIN users u ON sa.user_id = u.id
    `;

    const params: string[] = [];
    const conditions: string[] = [];

    if (date_from) {
      params.push(date_from as string);
      conditions.push(`s.date >= $${params.length}`);
    }
    if (date_to) {
      params.push(date_to as string);
      conditions.push(`s.date <= $${params.length}`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(" AND ")}`;
    }

    query += ` GROUP BY s.id ORDER BY s.date, s.start_time`;

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error("List shifts error:", err);
    res.status(500).json({ error: "Failed to fetch shifts" });
  }
});

// Get a single shift with full details.
router.get("/:id", authenticate, async (req: Request, res: Response) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*,
        COALESCE(json_agg(
          json_build_object(
            'id', sa.id,
            'userId', u.id,
            'fullName', u.full_name,
            'profession', u.profession
          ) ORDER BY sa.claimed_at
        ) FILTER (WHERE sa.id IS NOT NULL), '[]') AS assignments
       FROM shifts s
       LEFT JOIN shift_assignments sa ON s.id = sa.shift_id
       LEFT JOIN users u ON sa.user_id = u.id
       WHERE s.id = $1
       GROUP BY s.id`,
      [param(req, "id")]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: "Shift not found" });
      return;
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Get shift error:", err);
    res.status(500).json({ error: "Failed to fetch shift" });
  }
});

// Create a new shift (manager only).
router.post(
  "/",
  authenticate,
  requireRole("manager"),
  async (req: Request, res: Response) => {
    try {
      const { date, start_time, end_time, req_doctors, req_nurses, req_receptionists } =
        req.body;

      if (!date || !start_time || !end_time) {
        res.status(400).json({ error: "Date, start_time, and end_time are required" });
        return;
      }

      const isOvernight = end_time < start_time;

      const { rows } = await pool.query(
        `INSERT INTO shifts (date, start_time, end_time, is_overnight, req_doctors, req_nurses, req_receptionists, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          date,
          start_time,
          end_time,
          isOvernight,
          req_doctors ?? 0,
          req_nurses ?? 0,
          req_receptionists ?? 0,
          req.user!.userId,
        ]
      );

      res.status(201).json(rows[0]);
    } catch (err) {
      console.error("Create shift error:", err);
      res.status(500).json({ error: "Failed to create shift" });
    }
  }
);

// Edit a shift (manager only). Re-validates existing claims if time changes.
router.put(
  "/:id",
  authenticate,
  requireRole("manager"),
  async (req: Request, res: Response) => {
    const client = await pool.connect();
    try {
      const { date, start_time, end_time, req_doctors, req_nurses, req_receptionists } =
        req.body;

      await client.query("BEGIN");

      // Lock the shift row for the update + revalidation.
      const { rows: existing } = await client.query(
        "SELECT * FROM shifts WHERE id = $1 FOR UPDATE",
        [param(req, "id")]
      );

      if (existing.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ error: "Shift not found" });
        return;
      }

      const oldShift = existing[0];
      const newDate = date ?? oldShift.date;
      const newStart = start_time ?? oldShift.start_time;
      const newEnd = end_time ?? oldShift.end_time;
      const newIsOvernight = newEnd < newStart;

      const newReqDoctors = req_doctors ?? oldShift.req_doctors;
      const newReqNurses = req_nurses ?? oldShift.req_nurses;
      const newReqReceptionists = req_receptionists ?? oldShift.req_receptionists;

      // Check if time has changed — if so, revalidate all claims.
      const timeChanged =
        newDate !== oldShift.date.toISOString().slice(0, 10) ||
        newStart !== oldShift.start_time.slice(0, 5) ||
        newEnd !== oldShift.end_time.slice(0, 5);

      if (timeChanged) {
        const conflicts = await revalidateShiftClaims(
          client,
          parseInt(param(req, "id")),
          {
            date: newDate,
            start_time: newStart,
            end_time: newEnd,
            is_overnight: newIsOvernight,
          }
        );

        if (conflicts.length > 0) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: "Edit would create scheduling conflicts with existing claims.",
            conflicts,
          });
          return;
        }
      }

      // Check if capacity reduction would exceed current assignment count.
      const capacityChecks = [
        { profession: "doctor", newReq: newReqDoctors, col: "doctor" },
        { profession: "nurse", newReq: newReqNurses, col: "nurse" },
        { profession: "receptionist", newReq: newReqReceptionists, col: "receptionist" },
      ];

      for (const check of capacityChecks) {
        const { rows: countRows } = await client.query(
          `SELECT COUNT(*)::int AS cnt
           FROM shift_assignments sa
           JOIN users u ON sa.user_id = u.id
           WHERE sa.shift_id = $1 AND u.profession = $2`,
          [param(req, "id"), check.col]
        );
        if (countRows[0].cnt > check.newReq) {
          await client.query("ROLLBACK");
          res.status(409).json({
            error: `Cannot reduce ${check.profession} requirement to ${check.newReq} — ${countRows[0].cnt} are currently assigned. Remove assignments first.`,
          });
          return;
        }
      }

      await client.query(
        `UPDATE shifts SET date = $1, start_time = $2, end_time = $3, is_overnight = $4,
         req_doctors = $5, req_nurses = $6, req_receptionists = $7, updated_at = NOW()
         WHERE id = $8`,
        [
          newDate,
          newStart,
          newEnd,
          newIsOvernight,
          newReqDoctors,
          newReqNurses,
          newReqReceptionists,
          param(req, "id"),
        ]
      );

      await client.query("COMMIT");

      // Re-fetch the updated shift with assignments.
      const { rows: updated } = await pool.query(
        `SELECT s.*,
          COALESCE(json_agg(
            json_build_object('id', sa.id, 'userId', u.id, 'fullName', u.full_name, 'profession', u.profession)
            ORDER BY sa.claimed_at
          ) FILTER (WHERE sa.id IS NOT NULL), '[]') AS assignments
         FROM shifts s
         LEFT JOIN shift_assignments sa ON s.id = sa.shift_id
         LEFT JOIN users u ON sa.user_id = u.id
         WHERE s.id = $1
         GROUP BY s.id`,
        [param(req, "id")]
      );

      res.json(updated[0]);
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* swallow */ }
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
      }
      console.error("Edit shift error:", err);
      res.status(500).json({ error: "Failed to edit shift" });
    } finally {
      client.release();
    }
  }
);

// Delete a shift (manager only).
router.delete(
  "/:id",
  authenticate,
  requireRole("manager"),
  async (req: Request, res: Response) => {
    try {
      const { rowCount } = await pool.query(
        "DELETE FROM shifts WHERE id = $1",
        [param(req, "id")]
      );
      if (rowCount === 0) {
        res.status(404).json({ error: "Shift not found" });
        return;
      }
      res.json({ message: "Shift deleted" });
    } catch (err) {
      console.error("Delete shift error:", err);
      res.status(500).json({ error: "Failed to delete shift" });
    }
  }
);

// Claim a shift (staff claims for themselves).
router.post(
  "/:id/claim",
  authenticate,
  requireRole("staff"),
  async (req: Request, res: Response) => {
    try {
      await claimShift(
        parseInt(param(req, "id")),
        req.user!.userId,
        req.user!.profession!
      );
      res.json({ message: "Shift claimed successfully" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
      }
      console.error("Claim error:", err);
      res.status(500).json({ error: "Failed to claim shift" });
    }
  }
);

// Unclaim a shift (staff unclaims for themselves).
router.delete(
  "/:id/claim",
  authenticate,
  requireRole("staff"),
  async (req: Request, res: Response) => {
    try {
      await unclaimShift(parseInt(param(req, "id")), req.user!.userId);
      res.json({ message: "Shift unclaimed successfully" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
      }
      console.error("Unclaim error:", err);
      res.status(500).json({ error: "Failed to unclaim shift" });
    }
  }
);

// Manager assigns a staff member to a shift.
router.post(
  "/:id/assign",
  authenticate,
  requireRole("manager"),
  async (req: Request, res: Response) => {
    try {
      const { userId: staffUserId } = req.body;
      if (!staffUserId) {
        res.status(400).json({ error: "userId is required" });
        return;
      }
      await assignStaff(parseInt(param(req, "id")), staffUserId);
      res.json({ message: "Staff assigned successfully" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
      }
      console.error("Assign error:", err);
      res.status(500).json({ error: "Failed to assign staff" });
    }
  }
);

// Manager unassigns a staff member from a shift.
router.delete(
  "/:id/assign/:userId",
  authenticate,
  requireRole("manager"),
  async (req: Request, res: Response) => {
    try {
      await unclaimShift(parseInt(param(req, "id")), parseInt(param(req, "userId")));
      res.json({ message: "Staff unassigned successfully" });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message, details: err.details });
        return;
      }
      console.error("Unassign error:", err);
      res.status(500).json({ error: "Failed to unassign staff" });
    }
  }
);

export default router;
