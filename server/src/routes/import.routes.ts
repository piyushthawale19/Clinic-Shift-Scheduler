// Import routes — CSV file upload and import report viewing for managers.
import { Router, Request, Response } from "express";
import multer from "multer";
import { authenticate } from "../middleware/auth.js";
import { requireRole } from "../middleware/requireRole.js";
import { importStaff, importShifts } from "../importer/import.service.js";
import { pool } from "../db/pool.js";
import { AppError } from "../utils/errors.js";

const router = Router();

// Store uploads in memory — CSV files are small, no need for disk storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are accepted"));
    }
  },
});

// Upload and import a staff CSV file.
router.post(
  "/staff",
  authenticate,
  requireRole("manager"),
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No CSV file provided" });
        return;
      }
      const csvText = req.file.buffer.toString("utf-8");
      const result = await importStaff(csvText, req.user!.userId);
      res.json({
        reportId: result.reportId,
        summary: {
          total: result.result.accepted.length + result.result.autoCorrected.length +
                 result.result.merged.length + result.result.rejected.length,
          accepted: result.result.accepted.length,
          autoCorrected: result.result.autoCorrected.length,
          merged: result.result.merged.length,
          rejected: result.result.rejected.length,
        },
      });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error("Staff import error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  }
);

// Upload and import a shifts CSV file.
router.post(
  "/shifts",
  authenticate,
  requireRole("manager"),
  upload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "No CSV file provided" });
        return;
      }
      const csvText = req.file.buffer.toString("utf-8");
      const result = await importShifts(csvText, req.user!.userId);
      res.json({
        reportId: result.reportId,
        summary: {
          total: result.result.accepted.length + result.result.autoCorrected.length +
                 result.result.merged.length + result.result.rejected.length,
          accepted: result.result.accepted.length,
          autoCorrected: result.result.autoCorrected.length,
          merged: result.result.merged.length,
          rejected: result.result.rejected.length,
        },
      });
    } catch (err) {
      if (err instanceof AppError) {
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      console.error("Shifts import error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  }
);

// List all import reports (most recent first).
router.get(
  "/reports",
  authenticate,
  requireRole("manager"),
  async (_req: Request, res: Response) => {
    try {
      const { rows } = await pool.query(
        `SELECT id, import_type, imported_at, total_rows, accepted, rejected, auto_corrected, merged
         FROM import_reports
         ORDER BY imported_at DESC`
      );
      res.json(rows);
    } catch (err) {
      console.error("Report list error:", err);
      res.status(500).json({ error: "Failed to fetch reports" });
    }
  }
);

// Get a single import report with all entries.
router.get(
  "/reports/:id",
  authenticate,
  requireRole("manager"),
  async (req: Request, res: Response) => {
    try {
      const reportId = Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id;
      const { rows: reportRows } = await pool.query(
        "SELECT * FROM import_reports WHERE id = $1",
        [reportId]
      );
      if (reportRows.length === 0) {
        res.status(404).json({ error: "Report not found" });
        return;
      }

      const { rows: entries } = await pool.query(
        `SELECT row_number, original_data, action, problems, details, corrected_data
         FROM import_report_entries
         WHERE report_id = $1
         ORDER BY row_number`,
        [reportId]
      );

      res.json({ report: reportRows[0], entries });
    } catch (err) {
      console.error("Report detail error:", err);
      res.status(500).json({ error: "Failed to fetch report" });
    }
  }
);

export default router;
