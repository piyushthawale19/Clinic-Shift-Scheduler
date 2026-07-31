// Dashboard routes — provides week-view coverage data for the manager dashboard.
import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth.js";
import { pool } from "../db/pool.js";

const router = Router();

/**
 * Returns shifts for a given week with their coverage status.
 * Query params: week_start (ISO date, Monday of the week).
 * Defaults to the current week if not specified.
 */
router.get("/coverage", authenticate, async (req: Request, res: Response) => {
  try {
    const weekStartParam = req.query.week_start as string | undefined;
    let weekStart: string;

    if (weekStartParam) {
      weekStart = weekStartParam;
    } else {
      // Default to current week's Monday.
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
      weekStart = monday.toISOString().slice(0, 10);
    }

    // Calculate week end (Sunday).
    const startDate = new Date(weekStart);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    const weekEnd = endDate.toISOString().slice(0, 10);

    const { rows } = await pool.query(
      `SELECT s.id, s.date::text AS date, s.start_time::text AS start_time,
              s.end_time::text AS end_time, s.is_overnight,
              s.req_doctors, s.req_nurses, s.req_receptionists,
              COALESCE(json_agg(
                json_build_object(
                  'userId', u.id,
                  'fullName', u.full_name,
                  'profession', u.profession
                ) ORDER BY sa.claimed_at
              ) FILTER (WHERE sa.id IS NOT NULL), '[]') AS assignments,
              COUNT(CASE WHEN u.profession = 'doctor' THEN 1 END)::int AS assigned_doctors,
              COUNT(CASE WHEN u.profession = 'nurse' THEN 1 END)::int AS assigned_nurses,
              COUNT(CASE WHEN u.profession = 'receptionist' THEN 1 END)::int AS assigned_receptionists
       FROM shifts s
       LEFT JOIN shift_assignments sa ON s.id = sa.shift_id
       LEFT JOIN users u ON sa.user_id = u.id
       WHERE s.date >= $1 AND s.date <= $2
       GROUP BY s.id
       ORDER BY s.date, s.start_time`,
      [weekStart, weekEnd]
    );

    // Compute coverage status for each shift.
    const shifts = rows.map((row) => {
      const missingRoles: string[] = [];
      const doctorsNeeded = row.req_doctors - row.assigned_doctors;
      const nursesNeeded = row.req_nurses - row.assigned_nurses;
      const receptionistsNeeded = row.req_receptionists - row.assigned_receptionists;

      if (doctorsNeeded > 0) missingRoles.push(`${doctorsNeeded} doctor(s)`);
      if (nursesNeeded > 0) missingRoles.push(`${nursesNeeded} nurse(s)`);
      if (receptionistsNeeded > 0) missingRoles.push(`${receptionistsNeeded} receptionist(s)`);

      const totalRequired = row.req_doctors + row.req_nurses + row.req_receptionists;
      const totalAssigned = row.assigned_doctors + row.assigned_nurses + row.assigned_receptionists;

      let status: "fully_staffed" | "partially_staffed" | "empty";
      if (totalAssigned === 0) {
        status = "empty";
      } else if (missingRoles.length === 0) {
        status = "fully_staffed";
      } else {
        status = "partially_staffed";
      }

      return {
        ...row,
        status,
        missingRoles,
        totalRequired,
        totalAssigned,
      };
    });

    res.json({
      weekStart,
      weekEnd,
      shifts,
    });
  } catch (err) {
    console.error("Coverage error:", err);
    res.status(500).json({ error: "Failed to fetch coverage data" });
  }
});

export default router;
