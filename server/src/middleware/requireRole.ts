// Role guard middleware — restricts route access to specific user roles.
import { Request, Response, NextFunction } from "express";

export function requireRole(...roles: Array<"manager" | "staff">) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
