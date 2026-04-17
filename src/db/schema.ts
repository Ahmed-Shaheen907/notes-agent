import Database from "better-sqlite3";
import path from "path";

// The database file lives at ./data/notes.db.
// In Docker, we mount a host volume at /app/data so data survives restarts.
// Locally it sits in the notes-agent/ folder (gitignored).
const DATA_DIR = path.join(process.cwd(), "data");
import fs from "fs";
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, "notes.db");

let db: Database.Database;

/**
 * Returns the singleton database connection, creating it on first call.
 * We use a single shared connection because better-sqlite3 is synchronous —
 * there's no connection pool needed.
 */
export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    // WAL mode makes concurrent reads faster and is generally safer on crashes.
    db.pragma("journal_mode = WAL");
    runMigrations(db);
  }
  return db;
}

/**
 * Creates all required tables if they don't already exist.
 * Using IF NOT EXISTS means this is safe to call on every startup — it's
 * idempotent, so we never accidentally drop data.
 */
function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      body       TEXT NOT NULL,
      tags       TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      user_id    TEXT NOT NULL DEFAULT 'default'
    );

    -- Full-text search virtual table. This mirrors the notes table and lets
    -- us use SQLite FTS5 (full-text search) instead of slow LIKE queries.
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      id UNINDEXED,
      title,
      body,
      content=notes,
      content_rowid=rowid
    );

    -- Triggers keep the FTS index in sync with the notes table automatically.
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, id, title, body)
      VALUES (new.rowid, new.id, new.title, new.body);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, id, title, body)
      VALUES ('delete', old.rowid, old.id, old.title, old.body);
    END;

    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, id, title, body)
      VALUES ('delete', old.rowid, old.id, old.title, old.body);
      INSERT INTO notes_fts(rowid, id, title, body)
      VALUES (new.rowid, new.id, new.title, new.body);
    END;

    -- Stores vector embeddings for semantic search (bonus feature).
    -- Kept in a separate table so notes work fine even if OpenAI is unavailable.
    CREATE TABLE IF NOT EXISTS note_embeddings (
      note_id   TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    -- User accounts. username is stored lowercase for case-insensitive lookups.
    CREATE TABLE IF NOT EXISTS users (
      id            TEXT PRIMARY KEY,
      username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at    TEXT NOT NULL
    );
  `);
}
