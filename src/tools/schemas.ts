import type OpenAI from "openai";

/**
 * Tool schema definitions — OpenAI/Groq format.
 *
 * Why tool use instead of a separate intent classifier?
 * -------------------------------------------------------
 * We pass these schemas directly to the LLM. The model reads the names
 * and descriptions, then decides which tool to call — it IS the intent router.
 * If the user's request is ambiguous, the model asks for clarification naturally
 * rather than guessing.
 */
export const tools: OpenAI.Chat.ChatCompletionTool[] = [
  // ── 1. add_note ─────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "add_note",
      description:
        "Create a new note and save it to the database. Use this when the user " +
        "wants to save, record, write down, or remember something. " +
        "Infer a short descriptive title from the user's text if they don't provide one explicitly.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "A short, descriptive title for the note (max ~60 chars).",
          },
          body: {
            type: "string",
            description: "The full content of the note.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Optional list of tags. Normalise to lowercase (e.g. ['meetings', 'urgent']). " +
              "Infer tags from context if the user mentions a category.",
          },
        },
        required: ["title", "body"],
      },
    },
  },

  // ── 2. search_notes ──────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "search_notes",
      description:
        "Search the database for notes matching a keyword, tag, or date range. " +
        "Use this when the user wants to find, list, show, or retrieve notes. " +
        "If no filters are specified, it returns all notes. " +
        "Always call this before update_note or delete_note to find the right note ID.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Keyword or phrase to search in titles and bodies. Leave blank to list all notes.",
          },
          tags: {
            anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
            description: "Filter by tags — only notes that have ALL of these tags are returned. Omit or pass null if not filtering by tag.",
          },
          date_from: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "ISO 8601 date (e.g. '2024-01-01'). Only return notes created on or after this date. Omit or pass null if not filtering by start date.",
          },
          date_to: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "ISO 8601 date (e.g. '2024-01-31'). Only return notes created on or before this date. Omit or pass null if not filtering by end date.",
          },
        },
        required: [],
      },
    },
  },

  // ── 3. update_note ───────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "update_note",
      description:
        "Update the title, body, or tags of an existing note by its ID. " +
        "You MUST have the exact note ID first — use search_notes to find it. " +
        "If multiple notes match, list them and ask which one to update. " +
        "CRITICAL: Only include fields you want to change. " +
        "If you only want to change tags, pass only 'id' and 'tags' — do NOT include 'body' or 'title'. " +
        "Omitting a field means it stays unchanged. Passing body: '' will erase the note body.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The unique ID of the note to update (from search results).",
          },
          title: {
            type: "string",
            description: "New title. Omit to leave unchanged.",
          },
          body: {
            type: "string",
            description: "New body content. Omit to leave unchanged.",
          },
          tags: {
            type: "array",
            items: { type: "string" },
            description:
              "Replacement tag list — REPLACES all existing tags. Include any tags you want to keep.",
          },
        },
        required: ["id"],
      },
    },
  },

  // ── 4. delete_note ───────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "delete_note",
      description:
        "Permanently delete a note by ID. " +
        "TWO-STEP PROCESS — YOU MUST FOLLOW THIS EXACTLY: " +
        "Step 1: Call with confirmed=false to show the user what will be deleted. ALWAYS do this first. " +
        "Step 2: Only call with confirmed=true AFTER the user explicitly says yes/confirm/delete it. " +
        "NEVER call with confirmed=true on the first attempt. Always confirmed=false first.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The unique ID of the note to delete.",
          },
          confirmed: {
            type: "boolean",
            description: "false = show confirmation prompt. true = execute deletion (after user confirmed).",
          },
        },
        required: ["id", "confirmed"],
      },
    },
  },

  // ── 5. answer_question ───────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "answer_question",
      description:
        "Fetch notes relevant to a question so you can reason over them — " +
        "summarise, compare, detect contradictions, or extract patterns. " +
        "Use this when the user asks a question ABOUT their notes, not when performing CRUD.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search term to narrow which notes to fetch. Empty string = fetch all notes.",
          },
        },
        required: ["query"],
      },
    },
  },

  // ── 6. semantic_search_notes (bonus) ─────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "semantic_search_notes",
      description:
        "Find notes semantically similar to a query, even without exact keyword matches. " +
        "For example, 'project deadlines' can match a note saying 'submit deliverables by Friday'.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural language description of what you're looking for.",
          },
          top_k: {
            type: "number",
            description: "Maximum number of results to return (default 5).",
          },
        },
        required: ["query"],
      },
    },
  },
];
