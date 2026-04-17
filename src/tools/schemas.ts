import Anthropic from "@anthropic-ai/sdk";

/**
 * Tool schema definitions for every action the agent can take.
 *
 * Why tool use instead of a separate intent classifier?
 * -------------------------------------------------------
 * We pass these schemas directly to Claude's API. Claude reads the names and
 * descriptions, then decides which tool to call — it IS the intent router.
 * If the user's request is ambiguous, Claude asks for clarification naturally
 * as part of the conversation, rather than routing to a "confused" state.
 *
 * Each tool schema has three parts:
 *  - name: a snake_case identifier Claude uses to reference the tool
 *  - description: plain English telling Claude WHEN to use it
 *  - input_schema: a JSON Schema object defining the parameters Claude must fill
 */
export const tools: Anthropic.Tool[] = [
  // ── 1. add_note ─────────────────────────────────────────────────────────────
  {
    name: "add_note",
    description:
      "Create a new note and save it to the database. Use this when the user " +
      "wants to save, record, write down, or remember something. " +
      "Infer a short descriptive title from the user's text if they don't provide one explicitly.",
    input_schema: {
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
            "Optional list of tags or categories. Normalise to lowercase " +
            "(e.g. ['meetings', 'urgent']). Infer tags from context if the " +
            "user mentions a category but doesn't use the word 'tag'.",
        },
      },
      required: ["title", "body"],
    },
  },

  // ── 2. search_notes ──────────────────────────────────────────────────────────
  {
    name: "search_notes",
    description:
      "Search the database for notes matching a keyword, tag, or date range. " +
      "Use this when the user wants to find, list, show, or retrieve notes. " +
      "If no filters are specified, it returns all notes. " +
      "Always call this before update_note or delete_note to find the right note ID.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Keyword or phrase to search for in note titles and bodies. " +
            "Leave blank to list all notes.",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description:
            "Filter by tags — only notes that have ALL of these tags are returned.",
        },
        date_from: {
          type: "string",
          description: "ISO 8601 date string (e.g. '2024-01-01'). Only return notes created on or after this date.",
        },
        date_to: {
          type: "string",
          description: "ISO 8601 date string (e.g. '2024-01-31'). Only return notes created on or before this date.",
        },
      },
      required: [],
    },
  },

  // ── 3. update_note ───────────────────────────────────────────────────────────
  {
    name: "update_note",
    description:
      "Update the title, body, or tags of an existing note identified by its ID. " +
      "You MUST have the exact note ID before calling this — use search_notes first " +
      "if you don't have it. If multiple notes match the user's description, " +
      "present the options and ask which one to update.",
    input_schema: {
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
            "Replacement tag list. This REPLACES all existing tags — include " +
            "any tags you want to keep. Omit this field to leave tags unchanged.",
        },
      },
      required: ["id"],
    },
  },

  // ── 4. delete_note ───────────────────────────────────────────────────────────
  {
    name: "delete_note",
    description:
      "Permanently delete a note by ID. " +
      "IMPORTANT: you must ALWAYS call this twice for a deletion to succeed: " +
      "First call with confirmed=false to show the user what will be deleted. " +
      "Only call with confirmed=true after the user explicitly says yes/confirm/delete it.",
    input_schema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The unique ID of the note to delete.",
        },
        confirmed: {
          type: "boolean",
          description:
            "false = show a confirmation prompt to the user. " +
            "true = execute the deletion (only after user has confirmed).",
        },
      },
      required: ["id", "confirmed"],
    },
  },

  // ── 5. answer_question ───────────────────────────────────────────────────────
  {
    name: "answer_question",
    description:
      "Fetch notes relevant to a question so you can reason over them — " +
      "summarise, compare, detect contradictions, extract patterns, etc. " +
      "Use this when the user asks a question ABOUT their notes rather than " +
      "asking you to perform a CRUD operation. " +
      "Examples: 'Summarise everything tagged urgent', " +
      "'Do any of my notes contradict each other?', " +
      "'What decisions did I make last week?'",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A search term or tag to narrow down which notes to fetch. " +
            "Use an empty string to fetch ALL notes for full-corpus reasoning.",
        },
      },
      required: ["query"],
    },
  },

  // ── 6. semantic_search_notes (bonus) ─────────────────────────────────────────
  {
    name: "semantic_search_notes",
    description:
      "Find notes that are semantically similar to a natural language query, " +
      "even if they don't share any exact keywords. " +
      "Use this when a keyword search would miss relevant notes — for example " +
      "'find notes about project deadlines' might match a note that says " +
      "'submit deliverables by Friday' without containing the word 'deadline'. " +
      "Requires OPENAI_API_KEY to be set; falls back gracefully if unavailable.",
    input_schema: {
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
];
