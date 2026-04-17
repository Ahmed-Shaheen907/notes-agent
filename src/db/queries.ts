import { randomUUID } from "crypto";
import { getDb } from "./schema";
import type { Note, SearchParams, UpdateParams, DbResult } from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * SQLite stores tags as a JSON string (e.g. '["work","urgent"]').
 * This converts a raw DB row into a proper Note with a real string[] for tags.
 */
function rowToNote(row: Record<string, string>): Note {
  return {
    ...row,
    tags: JSON.parse(row.tags ?? "[]"),
  } as Note;
}

// ─── CREATE ───────────────────────────────────────────────────────────────────

export function createNote(
  title: string,
  body: string,
  tags: string[] = [],
  user_id: string = "default"
): DbResult<Note> {
  try {
    const db = getDb();
    const id = randomUUID();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO notes (id, title, body, tags, created_at, updated_at, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, title, body, JSON.stringify(tags), now, now, user_id);

    const note = db
      .prepare("SELECT * FROM notes WHERE id = ?")
      .get(id) as Record<string, string>;

    return { success: true, data: rowToNote(note) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── READ ─────────────────────────────────────────────────────────────────────

export function getNoteById(
  id: string,
  user_id: string = "default"
): DbResult<Note> {
  try {
    const db = getDb();
    const row = db
      .prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?")
      .get(id, user_id) as Record<string, string> | undefined;

    if (!row) {
      return { success: false, error: `No note found with id "${id}"` };
    }
    return { success: true, data: rowToNote(row) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function searchNotes(
  params: SearchParams
): DbResult<Note[]> {
  try {
    const db = getDb();
    const user_id = params.user_id ?? "default";

    // If there's a keyword query, use the FTS index for fast full-text search.
    // Otherwise fall back to fetching all notes for this user (which will then
    // be filtered by tag / date below).
    let rows: Record<string, string>[];

    if (params.query && params.query.trim() !== "") {
      // FTS5 match query — wrapping in quotes handles multi-word phrases.
      // We join back to the notes table to get all columns including tags.
      rows = db.prepare(`
        SELECT n.*
        FROM notes n
        JOIN notes_fts f ON n.id = f.id
        WHERE notes_fts MATCH ?
          AND n.user_id = ?
        ORDER BY n.created_at DESC
      `).all(`"${params.query.replace(/"/g, '""')}"`, user_id) as Record<string, string>[];
    } else {
      rows = db.prepare(`
        SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC
      `).all(user_id) as Record<string, string>[];
    }

    let notes = rows.map(rowToNote);

    // Filter by tags (note must have ALL requested tags)
    if (params.tags && params.tags.length > 0) {
      notes = notes.filter((note) =>
        params.tags!.every((tag) =>
          note.tags.map((t) => t.toLowerCase()).includes(tag.toLowerCase())
        )
      );
    }

    // Filter by date range
    if (params.date_from) {
      notes = notes.filter((note) => note.created_at >= params.date_from!);
    }
    if (params.date_to) {
      // Add one day so "to 2024-01-15" includes notes created on that day
      const to = new Date(params.date_to);
      to.setDate(to.getDate() + 1);
      notes = notes.filter((note) => note.created_at < to.toISOString());
    }

    return { success: true, data: notes };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

export function getAllNotes(user_id: string = "default"): DbResult<Note[]> {
  try {
    const db = getDb();
    const rows = db
      .prepare("SELECT * FROM notes WHERE user_id = ? ORDER BY created_at DESC")
      .all(user_id) as Record<string, string>[];
    return { success: true, data: rows.map(rowToNote) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── UPDATE ───────────────────────────────────────────────────────────────────

export function updateNote(params: UpdateParams): DbResult<Note> {
  try {
    const db = getDb();
    const user_id = params.user_id ?? "default";

    // First confirm the note exists and belongs to this user
    const existing = db
      .prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?")
      .get(params.id, user_id) as Record<string, string> | undefined;

    if (!existing) {
      return { success: false, error: `No note found with id "${params.id}"` };
    }

    const now = new Date().toISOString();

    // Build the SET clause dynamically — only update the fields that were provided.
    const fields: string[] = ["updated_at = ?"];
    const values: unknown[] = [now];

    if (params.title !== undefined) {
      fields.push("title = ?");
      values.push(params.title);
    }
    if (params.body !== undefined) {
      fields.push("body = ?");
      values.push(params.body);
    }
    if (params.tags !== undefined) {
      fields.push("tags = ?");
      values.push(JSON.stringify(params.tags));
    }

    values.push(params.id, user_id);

    db.prepare(`
      UPDATE notes SET ${fields.join(", ")} WHERE id = ? AND user_id = ?
    `).run(...values);

    const updated = db
      .prepare("SELECT * FROM notes WHERE id = ?")
      .get(params.id) as Record<string, string>;

    return { success: true, data: rowToNote(updated) };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export function deleteNote(
  id: string,
  user_id: string = "default"
): DbResult<{ deleted: Note }> {
  try {
    const db = getDb();

    const row = db
      .prepare("SELECT * FROM notes WHERE id = ? AND user_id = ?")
      .get(id, user_id) as Record<string, string> | undefined;

    if (!row) {
      return { success: false, error: `No note found with id "${id}"` };
    }

    db.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?").run(id, user_id);

    return { success: true, data: { deleted: rowToNote(row) } };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// ─── Embeddings (semantic search bonus) ──────────────────────────────────────

export function saveEmbedding(note_id: string, embedding: number[]): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO note_embeddings (note_id, embedding)
    VALUES (?, ?)
  `).run(note_id, JSON.stringify(embedding));
}

export function getAllEmbeddings(): { note_id: string; embedding: number[] }[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT note_id, embedding FROM note_embeddings")
    .all() as { note_id: string; embedding: string }[];
  return rows.map((r) => ({
    note_id: r.note_id,
    embedding: JSON.parse(r.embedding) as number[],
  }));
}
