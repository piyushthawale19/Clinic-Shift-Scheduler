// JWT verification middleware — extracts and validates the Bearer token, attaches user to request.
import { Request, Response, NextFunction } from "express";
import { verifyToken, TokenPayload } from "../services/auth.service.js";

// Extend Express Request to carry the authenticated user's payload.
declare global {
  namespace Express {
    interface Request {
      user?: TokenPayload;
    }
  }
}

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed authorization header" });
    return;
  }

  try {
    const token = header.slice(7);
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
