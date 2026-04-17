// ─── Core domain types ────────────────────────────────────────────────────────

/**
 * A single note as stored in (and returned from) the database.
 * Tags are stored as a JSON string in SQLite but are always parsed into an
 * array before being exposed to the rest of the codebase.
 */
export interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  user_id: string;
}

// ─── Parameters for DB query functions ────────────────────────────────────────

/** Parameters accepted by the search function. All fields are optional. */
export interface SearchParams {
  query?: string;   // Full-text keyword match against title + body
  tags?: string[];  // Return notes that have ALL of these tags
  date_from?: string; // ISO 8601 — only notes created on or after this date
  date_to?: string;   // ISO 8601 — only notes created on or before this date
  user_id?: string;
}

/** Fields that can be updated. At least one of title/body/tags must be provided. */
export interface UpdateParams {
  id: string;
  title?: string;
  body?: string;
  tags?: string[];
  user_id?: string;
}

// ─── Generic result wrapper ────────────────────────────────────────────────────

/**
 * Every DB function returns this shape so that handler code can always check
 * `result.success` before accessing `result.data`, rather than using try/catch
 * everywhere. This makes error propagation to Claude clean and consistent.
 */
export type DbResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };

// ─── Tool input types (what Claude sends us) ──────────────────────────────────

export interface AddNoteInput {
  title: string;
  body: string;
  tags?: string[];
}

export interface SearchNotesInput {
  query?: string;
  tags?: string[];
  date_from?: string;
  date_to?: string;
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  body?: string;
  tags?: string[];
}

export interface DeleteNoteInput {
  id: string;
  confirmed: boolean;
}

export interface AnswerQuestionInput {
  query: string;
}

export interface SemanticSearchInput {
  query: string;
  top_k?: number; // How many results to return (default: 5)
}
