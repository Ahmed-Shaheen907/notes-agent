import "dotenv/config";
import express from "express";
import path from "path";
import { createSession, runAgentTurn } from "./agent";
import type { Session } from "./agent";

const app = express();
app.use(express.json());

// Serve the HTML chat UI from the public/ folder
app.use(express.static(path.join(__dirname, "..", "public")));

// ─── In-memory session store ──────────────────────────────────────────────────

/**
 * Maps a browser session ID → Gemini ChatSession.
 * Each browser tab sends a unique sessionId (generated on page load) so
 * conversations are isolated per tab. Sessions are lost on server restart,
 * which is acceptable for this demo.
 */
const sessions = new Map<string, Session>();

function getOrCreateSession(sessionId: string, userId: string): Session {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, createSession(userId));
  }
  return sessions.get(sessionId)!;
}

// ─── Chat endpoint ────────────────────────────────────────────────────────────

/**
 * POST /api/chat
 * Body: { message: string, sessionId: string, userId?: string }
 * Response: { response: string }
 */
app.post("/api/chat", async (req, res) => {
  const { message, sessionId, userId } = req.body as {
    message: string;
    sessionId: string;
    userId?: string;
  };

  if (!message || !sessionId) {
    res.status(400).json({ error: "message and sessionId are required" });
    return;
  }

  try {
    const session = getOrCreateSession(sessionId, userId ?? "default");
    const response = await runAgentTurn(session, message);
    res.json({ response });
  } catch (err) {
    console.error("Agent error:", err);
    res.status(500).json({ error: "Agent error: " + String(err) });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`Notes Agent running at http://localhost:${PORT}`);
});
