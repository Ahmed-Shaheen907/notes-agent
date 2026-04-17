import "dotenv/config";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import { createSession, runAgentTurn } from "./agent";
import type { Session } from "./agent";
import { registerUser, loginUser, verifyToken } from "./auth";
import type { JwtPayload } from "./auth";

const app = express();
app.use(express.json());

// ─── Serve static pages ───────────────────────────────────────────────────────

const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

function serveHtml(file: string, res: Response) {
  const p = path.join(PUBLIC_DIR, file);
  if (!fs.existsSync(p)) {
    res.status(404).send("Not found");
    return;
  }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(fs.readFileSync(p, "utf-8"));
}

app.get("/", (_req, res) => serveHtml("index.html", res));
app.get("/login", (_req, res) => serveHtml("login.html", res));

// ─── Auth routes ──────────────────────────────────────────────────────────────

app.post("/api/auth/register", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const result = registerUser(username, password);
  if (!result.success) {
    res.status(400).json({ error: result.error });
    return;
  }
  res.json({ token: result.token, username: result.username });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body as { username?: string; password?: string };
  if (!username || !password) {
    res.status(400).json({ error: "username and password are required" });
    return;
  }
  const result = loginUser(username, password);
  if (!result.success) {
    res.status(401).json({ error: result.error });
    return;
  }
  res.json({ token: result.token, username: result.username });
});

// ─── Auth middleware ──────────────────────────────────────────────────────────

// Extends Express's Request type to carry the decoded JWT payload.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Invalid or expired token. Please log in again." });
    return;
  }
  req.user = payload;
  next();
}

// ─── In-memory session store ──────────────────────────────────────────────────

const sessions = new Map<string, Session>();

function getOrCreateSession(sessionId: string, userId: string): Session {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSession(userId));
  }
  return sessions.get(sessionId)!;
}

// ─── Chat endpoint ────────────────────────────────────────────────────────────

app.post("/api/chat", requireAuth, async (req, res) => {
  const { message, sessionId } = req.body as {
    message: string;
    sessionId: string;
  };

  if (!message || !sessionId) {
    res.status(400).json({ error: "message and sessionId are required" });
    return;
  }

  // userId comes exclusively from the verified JWT — never from the request body.
  const userId = req.user!.userId;

  try {
    const session = getOrCreateSession(sessionId, userId);
    const response = await runAgentTurn(session, message);
    res.json({ response });
  } catch (err) {
    console.error("Agent error:", err);
    res.status(500).json({ error: "Agent error: " + String(err) });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3000);

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Notes Agent running at http://localhost:${PORT}`);
  console.log("Press Ctrl+C to stop.");
});

server.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error(`Run this to free it:  npx kill-port ${PORT}`);
    console.error("Then run npm run dev again.");
  } else {
    console.error("Server error:", err.message);
  }
});

process.stdin.resume();
