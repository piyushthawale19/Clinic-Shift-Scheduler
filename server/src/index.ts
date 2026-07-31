// Express server entry point — assembles middleware and routes.
import express from "express";
import cors from "cors";
import { config } from "./config.js";
import authRoutes from "./routes/auth.routes.js";
import shiftRoutes from "./routes/shifts.routes.js";
import importRoutes from "./routes/import.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import { AppError } from "./utils/errors.js";

const app = express();

app.use(cors());
app.use(express.json());

// Mount routes.
app.use("/api/auth", authRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/import", importRoutes);
app.use("/api/dashboard", dashboardRoutes);

// Health check.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Global error handler — catches unhandled AppErrors and unexpected errors.
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({ error: err.message, details: err.details });
      return;
    }
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
);

app.listen(config.port, () => {
  console.log(`Server running on http://localhost:${config.port}`);
});

export default app;
