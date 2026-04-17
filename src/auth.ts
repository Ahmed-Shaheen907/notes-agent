import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import { getDb } from "./db/schema";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret-change-in-production";
const JWT_EXPIRES_IN = "30d";

export interface JwtPayload {
  userId: string;
  username: string;
}

// ─── Register ─────────────────────────────────────────────────────────────────

export function registerUser(
  username: string,
  password: string
): { success: true; token: string; username: string } | { success: false; error: string } {
  const clean = username.trim().toLowerCase();

  if (clean.length < 2) {
    return { success: false, error: "Username must be at least 2 characters." };
  }
  if (!/^[a-z0-9_.-]+$/.test(clean)) {
    return { success: false, error: "Username may only contain letters, numbers, _ . -" };
  }
  if (password.length < 6) {
    return { success: false, error: "Password must be at least 6 characters." };
  }

  try {
    const db = getDb();
    const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(clean);
    if (existing) {
      return { success: false, error: "Username already taken." };
    }

    const id = randomUUID();
    const passwordHash = bcrypt.hashSync(password, 12);
    const now = new Date().toISOString();

    db.prepare(
      "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)"
    ).run(id, clean, passwordHash, now);

    const token = jwt.sign({ userId: id, username: clean } satisfies JwtPayload, JWT_SECRET, {
      expiresIn: JWT_EXPIRES_IN,
    });
    return { success: true, token, username: clean };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────

export function loginUser(
  username: string,
  password: string
): { success: true; token: string; username: string } | { success: false; error: string } {
  const clean = username.trim().toLowerCase();

  try {
    const db = getDb();
    const row = db
      .prepare("SELECT id, username, password_hash FROM users WHERE username = ?")
      .get(clean) as { id: string; username: string; password_hash: string } | undefined;

    // Use the same error message for missing user and wrong password
    // to avoid username enumeration.
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      return { success: false, error: "Invalid username or password." };
    }

    const token = jwt.sign(
      { userId: row.id, username: row.username } satisfies JwtPayload,
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    return { success: true, token, username: row.username };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Verify ───────────────────────────────────────────────────────────────────

export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}
