// Auth service — handles password hashing/verification and JWT token operations.
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import { AuthenticationError } from "../utils/errors.js";

const BCRYPT_ROUNDS = 12;

export interface TokenPayload {
  userId: number;
  email: string;
  role: "manager" | "staff";
  profession: string | null;
}

// bcrypt.hash generates a unique per-user salt internally on every call.
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, config.jwtSecret, { expiresIn: "8h" });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, config.jwtSecret) as TokenPayload;
}

export async function login(
  email: string,
  password: string
): Promise<{ token: string; user: TokenPayload }> {
  const { rows } = await pool.query(
    "SELECT id, email, password_hash, role, profession FROM users WHERE email = $1",
    [email.toLowerCase().trim()]
  );

  if (rows.length === 0) {
    throw new AuthenticationError();
  }

  const user = rows[0];
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new AuthenticationError();
  }

  const payload: TokenPayload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    profession: user.profession,
  };

  return { token: signToken(payload), user: payload };
}
