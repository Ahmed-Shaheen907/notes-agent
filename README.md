# Notes Agent

A conversational note-taking agent built with TypeScript, Express, and Groq. Manage personal notes entirely through natural language — add, search, update, delete, and reason over notes through a web chat interface. Each user has a private account; notes are fully isolated between accounts.

---

## Features

- **Natural language CRUD** — save, search, update, delete notes by just talking
- **Multi-turn awareness** — follow-up references ("add a tag to that last note") work correctly
- **Delete confirmation** — agent always asks before permanently deleting
- **Full-text search** — SQLite FTS5 for fast keyword + tag + date-range queries
- **Deadline awareness** — agent knows today's date and highlights overdue / upcoming notes
- **Multi-user auth** — JWT-based login and registration; every user's notes are private
- **Markdown rendering** — agent responses render bold, lists, code blocks in the browser
- **Semantic search** *(optional)* — vector similarity search via OpenAI embeddings

---

## Quick Start (local)

### 1. Clone and install

```bash
git clone https://github.com/Ahmed-Shaheen907/notes-agent.git
cd notes-agent
npm install
```

### 2. Set up environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in:

```env
GROQ_API_KEY=your_groq_api_key_here
JWT_SECRET=any-long-random-string-you-choose
OPENAI_API_KEY=           # optional — only needed for semantic search
```

Get a free Groq API key at [console.groq.com](https://console.groq.com).

### 3. Start the server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser. You'll be redirected to the login page — create an account and start chatting.

---

## Running with Docker

Make sure Docker Desktop is running (check the whale icon in your system tray).

```bash
# Build the image and start the container
docker compose up
```

Open [http://localhost:3000](http://localhost:3000). Notes are saved to `./data/notes.db` on your host machine and survive container restarts.

> ⚠️ **Always use `docker compose up`, not `docker compose run`.**
> `docker compose run` skips the port mapping defined in `docker-compose.yml` so
> the app will start but port 3000 won't be reachable from your browser.

```bash
# Stop the container
docker compose down

# Rebuild after code changes
docker compose build && docker compose up
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GROQ_API_KEY` | **Yes** | Groq API key — free at [console.groq.com](https://console.groq.com) |
| `JWT_SECRET` | **Yes** | Any secret string used to sign auth tokens. Pick something long and random. |
| `OPENAI_API_KEY` | No | Only needed for semantic search (`semantic_search_notes` tool). |
| `PORT` | No | HTTP port (default: `3000`) |

---

## Running the Evaluation Harness

The eval harness runs 15 conversational scenarios against the live agent end-to-end and prints pass/fail for each.

### Prerequisites

- The server does **not** need to be running — the eval imports the agent directly and runs it in-process.
- You need a valid `GROQ_API_KEY` in your `.env` file.

### Step-by-step

**1. Make sure `.env` is set up**

```env
GROQ_API_KEY=your_groq_api_key_here
JWT_SECRET=anything
```

**2. Open a terminal in the project folder**

```bash
cd "path/to/notes-agent"
```

**3. Run the eval**

```bash
npm run eval
```

**4. Read the output**

```
============================================================
  Notes Agent — Evaluation Harness
  Test user: eval_1713456789012
============================================================

[1/15]  Add basic note with tag ................. ✓ PASS
[2/15]  List notes by tag ....................... ✓ PASS
...
[15/15] Update note tags without changing body .. ✓ PASS

============================================================
  Results: 15/15 passed
  Pass rate: 100%
============================================================
```

When a test fails, the agent's exact response is printed so you can see what went wrong:

```
[7/15] Search with no results — graceful message ... ✗ FAIL
   └─ Agent said: "..."
```

### Rate limit notes

The Groq free tier has two limits:

| Limit | Value | Effect |
|---|---|---|
| TPM (tokens per minute) | 8,000 | A 3-second delay between scenarios is built in — handles this automatically |
| TPD (tokens per day) | 200,000 | If you run the eval multiple times in one day you will hit this. Wait until the next day or upgrade your Groq plan. |

**Best practice:** Run the eval **once**, at the start of your day.

### What the 15 scenarios cover

| # | Scenario |
|---|---|
| 1 | Add a note with a tag |
| 2 | List notes by tag |
| 3 | Search by keyword |
| 4 | Update a note body |
| 5 | Delete with two-turn confirmation |
| 6 | Follow-up reference to a previous note |
| 7 | Search with no results — graceful message |
| 8 | Delete a non-existent note — graceful message |
| 9 | Summarise all notes tagged urgent |
| 10 | Detect contradictions across notes |
| 11 | Date-range search |
| 12 | Multi-step: add → search → update |
| 13 | Keyword search matches body, not just title |
| 14 | Add note with multiple tags |
| 15 | Update tags without changing body |

---

## Architecture

### Agentic loop

The agent maintains a `messages[]` array (full conversation history) and calls the Groq API in a loop until the model returns a plain text response with no tool calls. Every iteration the model either:

1. Calls one or more tools → results are added to `messages[]` → loop continues
2. Returns a text reply → loop exits, response is sent to the user

This gives the agent multi-turn awareness: "update that last note" works because the prior note creation is still in the messages array.

### Why tool use instead of a classifier?

Six tools are defined and passed directly to the Groq API. The model reads the descriptions and selects the right tool — it *is* the intent router. Ambiguous requests trigger a clarifying question rather than a wrong guess.

### Auth

- Passwords are hashed with **bcrypt** (12 rounds)
- Sessions use **30-day JWTs** signed with `JWT_SECRET`
- The `userId` in every DB query comes exclusively from the verified JWT — never from the request body
- Same error message for wrong username and wrong password (prevents username enumeration)

### Storage

SQLite via `better-sqlite3`. Notes use an FTS5 virtual table for fast full-text search. Triggers keep the FTS index in sync with the notes table automatically.

---

## File Structure

```
notes-agent/
├── src/
│   ├── server.ts         ← Express server, auth routes, chat endpoint
│   ├── agent.ts          ← Agentic loop + system prompt (injects today's date)
│   ├── auth.ts           ← registerUser, loginUser, verifyToken (bcrypt + JWT)
│   ├── tools/
│   │   ├── schemas.ts    ← Tool definitions passed to the Groq API
│   │   ├── handlers.ts   ← Business logic for each tool
│   │   └── index.ts      ← Dispatcher: tool name → handler
│   ├── db/
│   │   ├── schema.ts     ← SQLite connection, table migrations (notes + users)
│   │   └── queries.ts    ← All database read/write functions
│   └── types.ts          ← TypeScript interfaces
├── public/
│   ├── index.html        ← Chat UI (auth guard, markdown rendering, logout)
│   └── login.html        ← Login / create account page
├── tests/
│   └── eval.ts           ← 15-scenario evaluation harness
├── .env.example
├── Dockerfile
├── docker-compose.yml
└── README.md
```

---

## Tool Reference

### `add_note`
Creates a new note. Called immediately when the user says "save", "add", "record", "write down".

| Param | Type | Required | Description |
|---|---|---|---|
| `title` | string | Yes | Short descriptive title |
| `body` | string | Yes | Full note content |
| `tags` | string[] | No | Lowercase tag list |

### `search_notes`
Full-text + tag + date-range search. Also used internally before update/delete to find a note's ID.

| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | No | Keyword/phrase (FTS5) |
| `tags` | string[] | No | Must have ALL of these tags |
| `date_from` | string\|null | No | ISO 8601 — notes created on or after |
| `date_to` | string\|null | No | ISO 8601 — notes created on or before |

### `update_note`
Updates title, body, or tags. Agent must have the note ID from a prior search.

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Note ID |
| `title` | string | No | New title (omit to keep existing) |
| `body` | string | No | New body (omit to keep existing) |
| `tags` | string[] | No | Replaces all existing tags |

### `delete_note`
Two-step deletion. Agent always calls with `confirmed: false` first to show a preview, then `confirmed: true` only after the user explicitly agrees.

| Param | Type | Required | Description |
|---|---|---|---|
| `id` | string | Yes | Note ID |
| `confirmed` | boolean | Yes | `false` = preview, `true` = delete |

### `answer_question`
Fetches all relevant notes so the agent can reason over them — summarise, compare, detect contradictions.

| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Search term (empty = fetch all) |

### `semantic_search_notes` *(optional)*
Vector similarity search using OpenAI embeddings. Requires `OPENAI_API_KEY`.

| Param | Type | Required | Description |
|---|---|---|---|
| `query` | string | Yes | Natural language description |
| `top_k` | number | No | Max results (default 5) |
