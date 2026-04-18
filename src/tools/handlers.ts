import OpenAI from "openai";
import {
  createNote,
  searchNotes,
  getAllNotes,
  getNoteById,
  updateNote,
  deleteNote,
  saveEmbedding,
  getAllEmbeddings,
} from "../db/queries";
import type {
  AddNoteInput,
  SearchNotesInput,
  UpdateNoteInput,
  DeleteNoteInput,
  AnswerQuestionInput,
  SemanticSearchInput,
  Note,
} from "../types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Formats a Note into a compact, readable string for Claude to reason over.
 * Claude gets this text and uses it to compose its natural language reply.
 */
function formatNote(note: Note): string {
  const tags = note.tags.length > 0 ? `[${note.tags.join(", ")}]` : "(no tags)";
  return (
    `ID: ${note.id}\n` +
    `Title: ${note.title}\n` +
    `Tags: ${tags}\n` +
    `Created: ${note.created_at.slice(0, 10)}\n` +
    `Body: ${note.body}`
  );
}

/**
 * Cosine similarity between two vectors.
 * Returns a number between -1 (opposite) and 1 (identical).
 * We use this to rank notes by how semantically close they are to a query.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// ─── Tool Handlers ────────────────────────────────────────────────────────────

/**
 * Each handler receives the parsed tool input and a user_id (for multi-user
 * isolation), and returns a plain string that gets sent back to Claude as the
 * tool_result. Claude then reads that string and composes its reply to the user.
 */

export async function handleAddNote(
  input: AddNoteInput,
  userId: string
): Promise<string> {
  const result = createNote(input.title, input.body, input.tags ?? [], userId);

  if (!result.success) {
    return `Error creating note: ${result.error}`;
  }

  const note = result.data;

  // Bonus: generate an embedding for semantic search in the background.
  // We don't await this — if it fails, the note is still saved.
  generateAndSaveEmbedding(note.id, `${note.title}\n${note.body}`).catch(
    () => { /* silently skip if OpenAI is not configured */ }
  );

  return (
    `Note created successfully.\n` +
    `ID: ${note.id}\n` +
    `Title: ${note.title}\n` +
    `Tags: ${note.tags.length > 0 ? note.tags.join(", ") : "none"}\n` +
    `Created: ${note.created_at.slice(0, 10)}`
  );
}

export function handleSearchNotes(
  input: SearchNotesInput,
  userId: string
): string {
  const result = searchNotes({
    query: input.query ?? undefined,
    tags: input.tags ?? undefined,   // treat null same as omitted
    date_from: input.date_from ?? undefined,   // treat null same as omitted
    date_to: input.date_to ?? undefined,
    user_id: userId,
  });

  if (!result.success) {
    return `Error searching notes: ${result.error}`;
  }

  const notes = result.data;

  if (notes.length === 0) {
    const filters: string[] = [];
    if (input.query) filters.push(`keyword "${input.query}"`);
    if (input.tags?.length) filters.push(`tags [${input.tags.join(", ")}]`);
    if (input.date_from) filters.push(`from ${input.date_from}`);
    if (input.date_to) filters.push(`to ${input.date_to}`);

    const filterDesc =
      filters.length > 0 ? ` matching ${filters.join(" and ")}` : "";
    return (
      `No results found — 0 notes${filterDesc}. ` +
      `Tell the user you found no notes matching their search. ` +
      `Suggestions: try broader keywords, check tag spelling, or widen the date range.`
    );
  }

  return (
    `Found ${notes.length} note(s):\n\n` +
    notes.map(formatNote).join("\n\n---\n\n")
  );
}

export async function handleUpdateNote(
  input: UpdateNoteInput,
  userId: string
): Promise<string> {
  // Strip out empty-string fields — the LLM sometimes passes body: "" or title: ""
  // when it only intends to change tags. An empty string would erase the field in DB.
  const safeInput: UpdateNoteInput = { id: input.id };
  if (input.title !== undefined && input.title !== "") safeInput.title = input.title;
  if (input.body !== undefined && input.body !== "") safeInput.body = input.body;
  if (input.tags !== undefined) safeInput.tags = input.tags;

  // Validate that at least one field is being changed
  if (
    safeInput.title === undefined &&
    safeInput.body === undefined &&
    safeInput.tags === undefined
  ) {
    return "No changes specified. Please provide at least one of: title, body, or tags.";
  }

  const result = updateNote({
    id: safeInput.id,
    title: safeInput.title,
    body: safeInput.body,
    tags: safeInput.tags,
    user_id: userId,
  });

  if (!result.success) {
    return `Error updating note: ${result.error}`;
  }

  const note = result.data;

  // Regenerate embedding if the body changed
  if (input.body !== undefined || input.title !== undefined) {
    generateAndSaveEmbedding(note.id, `${note.title}\n${note.body}`).catch(
      () => {}
    );
  }

  return (
    `Note updated successfully.\n` +
    `ID: ${note.id}\n` +
    `Title: ${note.title}\n` +
    `Tags: ${note.tags.length > 0 ? note.tags.join(", ") : "none"}\n` +
    `Updated: ${note.updated_at.slice(0, 10)}\n` +
    `Body: ${note.body}`
  );
}

export function handleDeleteNote(
  input: DeleteNoteInput,
  userId: string
): string {
  // Step 1: confirmed=false → look up the note and ask the user to confirm.
  // This is the first call Claude makes. It returns a description of what will
  // be deleted so the user knows exactly what they're agreeing to delete.
  if (!input.confirmed) {
    const lookup = getNoteById(input.id, userId);

    if (!lookup.success) {
      return `Note not found — there are no notes matching that ID. Tell the user you could not find the note and cannot delete it.`;
    }

    const note = lookup.data;
    return (
      `⚠️  You are about to permanently delete this note:\n\n` +
      formatNote(note) +
      `\n\nReply "yes", "confirm", or "delete it" to proceed. This cannot be undone.`
    );
  }

  // Step 2: confirmed=true → actually delete it.
  const result = deleteNote(input.id, userId);

  if (!result.success) {
    return `Error deleting note: ${result.error}`;
  }

  return `Note "${result.data.deleted.title}" has been permanently deleted.`;
}

export function handleAnswerQuestion(
  input: AnswerQuestionInput,
  userId: string
): string {
  // Always fetch ALL notes — the query is a hint for Claude to reason over,
  // not a DB filter. Using searchNotes() here would run FTS and return empty
  // when the query word (e.g. "summary") doesn't appear in any note body.
  const result = getAllNotes(userId);

  if (!result.success) {
    return `Error fetching notes: ${result.error}`;
  }

  const notes = result.data;

  if (notes.length === 0) {
    return "No notes found to answer your question. Your note collection appears to be empty.";
  }

  // We return all relevant notes as text. Claude will then reason over this
  // content and compose the actual answer in its next response turn.
  return (
    `Here are the relevant notes (${notes.length} total). ` +
    `Use these to answer the user's question:\n\n` +
    notes.map(formatNote).join("\n\n---\n\n")
  );
}

export async function handleSemanticSearch(
  input: SemanticSearchInput,
  userId: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return (
      "Semantic search is not available — OPENAI_API_KEY is not set. " +
      "Try a regular keyword search with the search_notes tool instead."
    );
  }

  try {
    const openai = new OpenAI({ apiKey });
    const topK = input.top_k ?? 5;

    // Embed the search query using the same model we used for the notes.
    const queryEmbeddingResponse = await openai.embeddings.create({
      model: "text-embedding-3-small",
      input: input.query,
    });
    const queryVector = queryEmbeddingResponse.data[0].embedding;

    // Load all stored embeddings from SQLite, compute cosine similarity, rank.
    const stored = getAllEmbeddings();

    if (stored.length === 0) {
      return (
        "No embeddings found. Notes may have been added without semantic indexing. " +
        "Try the regular search_notes tool instead."
      );
    }

    const ranked = stored
      .map((e) => ({
        note_id: e.note_id,
        score: cosineSimilarity(queryVector, e.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    // Fetch the actual note content for the top results
    const noteResults = ranked
      .map(({ note_id, score }) => {
        const r = getNoteById(note_id, userId);
        if (!r.success) return null;
        return { note: r.data, score };
      })
      .filter((x): x is { note: Note; score: number } => x !== null);

    if (noteResults.length === 0) {
      return "No semantically similar notes found for your query.";
    }

    return (
      `Found ${noteResults.length} semantically similar note(s):\n\n` +
      noteResults
        .map(
          ({ note, score }) =>
            `[Similarity: ${(score * 100).toFixed(1)}%]\n${formatNote(note)}`
        )
        .join("\n\n---\n\n")
    );
  } catch (err) {
    return `Semantic search failed: ${String(err)}`;
  }
}

// ─── Internal: embedding generation ──────────────────────────────────────────

async function generateAndSaveEmbedding(
  noteId: string,
  text: string
): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return; // Skip silently if OpenAI is not configured

  const openai = new OpenAI({ apiKey });
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });

  saveEmbedding(noteId, response.data[0].embedding);
}
