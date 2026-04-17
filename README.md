# Notes Agent

A conversational note-taking agent built with TypeScript and Claude. Manage personal notes entirely through natural language — add, search, update, delete, and reason over notes in a terminal chat interface.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# 3. Run the agent
npm run dev
```

### Example conversation

```
You: Save a note about the team standup — we agreed to move it to Tuesdays. Tag it meetings.
Agent: Done! I've saved your note "Team Standup" tagged as meetings.

You: What did I write about the standup?
Agent: You have a note titled "Team Standup": we agreed to move it to Tuesdays.

You: Update it — it's actually moving to Wednesdays.
Agent: Updated. The standup note now says the meeting is on Wednesdays.

You: Delete the standup note.
Agent: ⚠️ You're about to permanently delete "Team Standup". Reply "yes" to confirm.

You: Yes.
Agent: "Team Standup" has been permanently deleted.
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key from [console.anthropic.com](https://console.anthropic.com) |
| `OPENAI_API_KEY` | No | OpenAI key — only needed for semantic search |
| `DEFAULT_USER` | No | Default user ID (defaults to `"default"`) |

---

## Multi-User Support

Pass `--user <id>` to scope notes to a specific user:

```bash
npm run dev -- --user alice
npm run dev -- --user bob
```

Each user's notes are isolated — Alice cannot see Bob's notes. In a production system you would derive the user ID from a JWT token in a request header; here it's a CLI flag for simplicity.

---

## Running with Docker

```bash
# Build and start
docker compose up

# With a specific user
docker compose run notes-agent node dist/index.js --user alice
```

Notes are saved to `./data/notes.db` on your host machine and persist between container restarts.

---

## Running the Evaluation Harness

```bash
npm run eval
```

Runs 15 conversational scenarios against the live agent and prints pass/fail results. Requires `ANTHROPIC_API_KEY` to be set. Uses a unique test user ID so it never pollutes your real notes.

---

## Architecture

### Why tool use instead of a classifier?

The assessment asked for "clean, well-typed tool interfaces" as the intent routing mechanism. Rather than building a separate classifier step, we define 6 tools and pass them to Claude's API. Claude reads the tool descriptions and picks the right one — it *is* the intent router. If a request is ambiguous, Claude asks for clarification naturally within the conversation.

### Conversation state

The agent keeps a `messages: MessageParam[]` array in memory for the session. Every API call includes the full array, giving Claude complete context. This is why multi-turn follow-ups work: "add a tag to that last note" works because the previous note creation is still in the messages array.

### Storage

Notes are stored in SQLite (`data/notes.db`) using `better-sqlite3`.

**Why SQLite?**
- Zero setup — single file, no server
- Synchronous API (no async boilerplate)
- Full-text search via FTS5 virtual table
- Easy to inspect with any SQLite GUI
- Simple to explain in an interview

Tags are stored as a JSON string in the `tags` column and parsed into `string[]` whenever a note is read from the database.

### Semantic search

When a note is created or updated, its title + body is sent to OpenAI's `text-embedding-3-small` model and the resulting vector (1536 dimensions) is saved to the `note_embeddings` table. Semantic search loads all stored vectors, computes cosine similarity against the query vector, and returns the top-k results. This finds notes that are *conceptually* related even when they share no exact keywords.

**Why `text-embedding-3-small`?**
- Best price/performance for general text ($0.02/1M tokens)
- Well-documented and widely used
- 1536-dimensional vectors — compact enough to store in SQLite as JSON

---

## Tool Schema Documentation

This section documents every tool the agent can call. This is the primary evaluation artefact — it shows how CRUD operations are decomposed into clean, typed interfaces.

---

### `add_note`

Creates a new note and saves it to the database.

**When used:** User wants to save, record, write down, or remember something.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `title` | `string` | Yes | Short descriptive title (max ~60 chars). Inferred from context if not explicit. |
| `body` | `string` | Yes | Full content of the note. |
| `tags` | `string[]` | No | Tag list, normalised to lowercase. Inferred from context. |

**Returns:** Confirmation string with the new note's ID, title, tags, and creation date.

---

### `search_notes`

Searches the database for notes matching a keyword, tag, or date range.

**When used:** User wants to find, list, show, or retrieve notes. Also called before `update_note` or `delete_note` to find the target note's ID.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | No | Keyword/phrase to match against titles and bodies (uses SQLite FTS5). |
| `tags` | `string[]` | No | Filter to notes that have ALL of these tags. |
| `date_from` | `string` | No | ISO 8601 date — only notes created on or after this date. |
| `date_to` | `string` | No | ISO 8601 date — only notes created on or before this date. |

**Returns:** Formatted list of matching notes (ID, title, tags, date, body), or a "no results" message with suggestions.

---

### `update_note`

Updates the title, body, or tags of an existing note.

**When used:** User wants to change, edit, or modify an existing note. The agent must have the note's ID (from a prior `search_notes` call) before calling this.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique note ID from search results. |
| `title` | `string` | No | New title. Omit to leave unchanged. |
| `body` | `string` | No | New body content. Omit to leave unchanged. |
| `tags` | `string[]` | No | Replacement tag list — **replaces all existing tags**. Include any tags you want to keep. |

**Returns:** The updated note's full content, or an error if the ID was not found.

---

### `delete_note`

Permanently deletes a note. Always requires a two-call confirmation flow.

**When used:** User wants to remove or delete a note. Claude must always call this with `confirmed: false` first, show the user what will be deleted, then call again with `confirmed: true` only after explicit user consent.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `id` | `string` | Yes | Unique note ID. |
| `confirmed` | `boolean` | Yes | `false` = show confirmation prompt. `true` = execute deletion. |

**Returns:**
- `confirmed: false` → A warning message showing exactly which note will be deleted.
- `confirmed: true` → Confirmation that the note was deleted.

---

### `answer_question`

Fetches notes for Claude to reason over — summarising, comparing, or detecting contradictions.

**When used:** User asks a question *about* their notes rather than requesting a CRUD operation. Examples: "Summarise everything tagged urgent", "Do any notes contradict each other?", "What decisions did I make last week?"

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Search term to narrow which notes to fetch. Empty string = fetch all notes. |

**Returns:** Raw note content (all matching notes formatted as text) for Claude to reason over. Claude then composes the actual answer in its next response.

---

### `semantic_search_notes` *(bonus)*

Finds notes that are semantically similar to a query using vector embeddings.

**When used:** Keyword search would miss relevant notes because they use different vocabulary. Example: "notes about project deadlines" should match a note saying "submit deliverables by Friday" even without the word "deadline".

**Requires:** `OPENAI_API_KEY` to be set.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `query` | `string` | Yes | Natural language description of what to find. |
| `top_k` | `number` | No | Maximum results to return (default: 5). |

**Returns:** Top-k most similar notes with their similarity percentage, or a fallback message if embeddings are unavailable.

---

## File Structure

```
notes-agent/
├── src/
│   ├── index.ts          ← CLI entry point (readline loop + --user flag)
│   ├── agent.ts          ← Agentic loop: Claude API calls + tool dispatch
│   ├── tools/
│   │   ├── schemas.ts    ← Tool definitions passed to Claude's API
│   │   ├── handlers.ts   ← Business logic for each tool
│   │   └── index.ts      ← Dispatcher: tool name → handler function
│   ├── db/
│   │   ├── schema.ts     ← SQLite connection + table migrations
│   │   └── queries.ts    ← All database read/write functions
│   └── types.ts          ← TypeScript interfaces
├── tests/
│   └── eval.ts           ← 15-scenario evaluation harness
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── README.md
```
