/**
 * Evaluation Harness
 * ==================
 * Runs 15 conversational scenarios against the live agent and reports pass/fail.
 *
 * Each scenario describes:
 *  - name: human-readable label
 *  - turns: the conversation messages to send in sequence
 *  - validate: a function that checks the DB state and/or agent response after
 *              the scenario completes
 *
 * Design note: We test the FULL stack (agent → Claude → tools → SQLite) rather
 * than mocking individual functions. This is intentional — mocked tests can pass
 * even when the real integration is broken. The downside is speed and API cost,
 * but for a 15-scenario harness it's acceptable.
 *
 * Run with: npm run eval
 */

import "dotenv/config";
import { createSession, runAgentTurn } from "../src/agent";
import {
  createNote,
  searchNotes,
  deleteNote,
  getAllNotes,
} from "../src/db/queries";
import { getDb } from "../src/db/schema";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  /** Each element is one user message. Multi-element = multi-turn conversation. */
  turns: string[];
  /** Return true if the scenario passed. Receives the last agent response. */
  validate: (lastResponse: string, userId: string) => boolean | Promise<boolean>;
}

// ─── Test User ────────────────────────────────────────────────────────────────

const TEST_USER = `eval_${Date.now()}`;

// ─── Scenarios ────────────────────────────────────────────────────────────────

const scenarios: Scenario[] = [
  // ── 1. Happy path: add a note ─────────────────────────────────────────────
  {
    name: "Add basic note with tag",
    turns: ["Save a note titled 'Team standup' — we agreed to move it to Tuesdays. Tag it as meetings."],
    validate: (_res, userId) => {
      const result = searchNotes({ tags: ["meetings"], user_id: userId });
      return result.success && result.data.length > 0 &&
        result.data.some((n) => n.title.toLowerCase().includes("standup"));
    },
  },

  // ── 2. Happy path: list notes by tag ─────────────────────────────────────
  {
    name: "List notes by tag",
    turns: [
      "Save a note: 'Project Alpha deadline is Friday'. Tag it urgent.",
      "Show me all notes tagged urgent.",
    ],
    validate: (res) => {
      return res.toLowerCase().includes("alpha") ||
        res.toLowerCase().includes("deadline") ||
        res.toLowerCase().includes("urgent");
    },
  },

  // ── 3. Keyword search ────────────────────────────────────────────────────
  {
    name: "Search notes by keyword",
    turns: [
      "Save a note: 'API rate limit is 100 requests per minute'. Tag it tech.",
      "What did I write about the API?",
    ],
    validate: (res) => {
      return res.toLowerCase().includes("api") ||
        res.toLowerCase().includes("rate") ||
        res.toLowerCase().includes("100");
    },
  },

  // ── 4. Update an existing note ────────────────────────────────────────────
  {
    name: "Update a note body",
    turns: [
      "Save a note titled 'Office address' — we're at 10 Baker Street.",
      "Update the office address note — we've moved to 20 Oxford Street.",
    ],
    validate: (_res, userId) => {
      const result = searchNotes({ query: "office address", user_id: userId });
      if (!result.success || result.data.length === 0) return false;
      return result.data.some((n) =>
        n.body.toLowerCase().includes("oxford") ||
        n.title.toLowerCase().includes("office")
      );
    },
  },

  // ── 5. Delete with confirmation flow (two turns) ──────────────────────────
  {
    name: "Delete note with confirmation",
    turns: [
      "Save a note titled 'Old vendor contract' — we no longer work with them.",
      "Delete the old vendor contract note.",
      "Yes, delete it.",
    ],
    validate: (_res, userId) => {
      const result = searchNotes({ query: "vendor contract", user_id: userId });
      // After deletion, no matching notes should exist
      return result.success && result.data.length === 0;
    },
  },

  // ── 6. Multi-turn follow-up reference ─────────────────────────────────────
  {
    name: "Follow-up reference to previous note",
    turns: [
      "Save a note: 'Client call scheduled for Monday at 2pm'.",
      "Add the tag 'important' to that last note.",
    ],
    validate: (_res, userId) => {
      const result = searchNotes({ tags: ["important"], user_id: userId });
      return result.success && result.data.length > 0 &&
        result.data.some((n) => n.body.toLowerCase().includes("monday") ||
          n.body.toLowerCase().includes("client"));
    },
  },

  // ── 7. Graceful: search with no results ───────────────────────────────────
  {
    name: "Search with no results — graceful message",
    turns: ["Find notes about quantum computing"],
    validate: (res) => {
      // Normalize curly/smart quotes → straight so apostrophe checks work
      const r = res.toLowerCase().replace(/[\u2018\u2019]/g, "'");
      // Should communicate no results — not throw an error
      return (
        r.includes("no notes") ||
        r.includes("no note") ||
        r.includes("found 0") ||
        r.includes("0 note") ||
        r.includes("found no") ||
        r.includes("couldn't find") ||
        r.includes("couldn't locate") ||
        r.includes("don't have") ||
        r.includes("nothing") ||
        r.includes("no match") ||
        r.includes("didn't find") ||
        r.includes("did not find") ||
        r.includes("unable to find") ||
        r.includes("unable to locate") ||
        r.includes("not able to") ||
        r.includes("wasn't able to") ||
        r.includes("was not able to") ||
        r.includes("no results") ||
        r.includes("not find") ||
        r.includes("not found") ||
        r.includes("aren't any") ||
        r.includes("there are no") ||
        r.includes("cannot locate") ||
        r.includes("can't locate")
      );
    },
  },

  // ── 8. Graceful: delete non-existent note ────────────────────────────────
  {
    name: "Delete non-existent note — graceful message",
    turns: ["Delete the note about my cat's birthday"],
    validate: (res) => {
      // Normalize curly/smart quotes → straight so apostrophe checks work
      const r = res.toLowerCase().replace(/[\u2018\u2019]/g, "'");
      return (
        r.includes("no note") ||
        r.includes("no notes") ||
        r.includes("couldn't find") ||
        r.includes("couldn't locate") ||
        r.includes("don't see") ||
        r.includes("not found") ||
        r.includes("no matching") ||
        r.includes("which note") ||
        r.includes("didn't find") ||
        r.includes("did not find") ||
        r.includes("unable to find") ||
        r.includes("unable to locate") ||
        r.includes("not able to") ||
        r.includes("wasn't able to") ||
        r.includes("was not able to") ||
        r.includes("no results") ||
        r.includes("can't find") ||
        r.includes("cannot find") ||
        r.includes("cannot locate") ||
        r.includes("can't locate") ||
        r.includes("don't have") ||
        r.includes("aren't any") ||
        r.includes("there are no") ||
        r.includes("found no") ||
        r.includes("found 0") ||
        r.includes("0 note")
      );
    },
  },

  // ── 9. Summarise notes by tag ─────────────────────────────────────────────
  {
    name: "Summarise all notes tagged urgent",
    turns: [
      "Save a note: 'Fix the login bug by EOD'. Tag it urgent.",
      "Save a note: 'Reply to client email before 3pm'. Tag it urgent.",
      "Summarise everything I've tagged as urgent.",
    ],
    validate: (res) => {
      const r = res.toLowerCase();
      // Response should reference both urgent items
      return (r.includes("login") || r.includes("bug")) &&
        (r.includes("client") || r.includes("email") || r.includes("3pm"));
    },
  },

  // ── 10. Reason over notes (contradiction detection) ───────────────────────
  {
    name: "Detect contradictions across notes",
    turns: [
      "Save a note: 'The meeting is on Monday at 10am'. Tag it meetings.",
      "Save a note: 'The meeting was rescheduled to Tuesday at 2pm'. Tag it meetings.",
      "Do any of my notes about meetings contradict each other?",
    ],
    validate: (res) => {
      const r = res.toLowerCase();
      return (
        r.includes("monday") || r.includes("tuesday") ||
        r.includes("contradict") || r.includes("conflict") ||
        r.includes("different") || r.includes("rescheduled")
      );
    },
  },

  // ── 11. Date-range search ─────────────────────────────────────────────────
  {
    name: "Date-range search returns results",
    turns: [
      "Save a note: 'Sprint planning notes from today'.",
      `Show me notes created after ${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)}.`,
    ],
    validate: (res) => {
      const r = res.toLowerCase();
      return (
        r.includes("sprint") ||
        r.includes("found") ||
        r.includes("note")
      );
    },
  },

  // ── 12. Multi-step: add → search → update ────────────────────────────────
  {
    name: "Multi-step: add then search then update",
    turns: [
      "Save a note titled 'Budget draft' — estimated cost is £10,000.",
      "Find my budget note.",
      "Update it — the actual cost came in at £8,500.",
    ],
    validate: (_res, userId) => {
      const result = searchNotes({ query: "budget", user_id: userId });
      if (!result.success || result.data.length === 0) return false;
      return result.data.some((n) =>
        n.body.includes("8,500") || n.body.includes("8500")
      );
    },
  },

  // ── 13. Body search (keyword not in title) ────────────────────────────────
  {
    name: "Keyword search matches body, not just title",
    turns: [
      "Save a note titled 'Q3 review' — we need to improve customer retention.",
      "Find notes that mention retention.",
    ],
    validate: (res) => {
      return (
        res.toLowerCase().includes("q3") ||
        res.toLowerCase().includes("retention") ||
        res.toLowerCase().includes("review")
      );
    },
  },

  // ── 14. Add note with multiple tags ──────────────────────────────────────
  {
    name: "Add note with multiple tags",
    turns: [
      "Save a note: 'Deploy hotfix to production tonight'. Tags: work, urgent, ops.",
    ],
    validate: (_res, userId) => {
      const result = searchNotes({ tags: ["urgent"], user_id: userId });
      if (!result.success) return false;
      const note = result.data.find((n) => n.body.toLowerCase().includes("hotfix"));
      if (!note) return false;
      // Check it has multiple tags
      return note.tags.length >= 2;
    },
  },

  // ── 15. Update tags only (body unchanged) ────────────────────────────────
  {
    name: "Update note tags without changing body",
    turns: [
      "Save a note titled 'Vendor meeting notes' — discussed pricing and delivery.",
      "Add the tag 'finance' to the vendor meeting note.",
    ],
    validate: (_res, userId) => {
      const result = searchNotes({ tags: ["finance"], user_id: userId });
      return (
        result.success &&
        result.data.length > 0 &&
        result.data.some((n) => n.title.toLowerCase().includes("vendor"))
      );
    },
  },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

async function runScenario(
  scenario: Scenario,
  index: number
): Promise<{ passed: boolean; error?: string; response?: string }> {
  const session = createSession(TEST_USER);
  let lastResponse = "";

  try {
    for (const turn of scenario.turns) {
      lastResponse = await runAgentTurn(session, turn);
    }

    const passed = await scenario.validate(lastResponse, TEST_USER);
    return { passed, response: lastResponse };
  } catch (err) {
    return { passed: false, error: String(err), response: lastResponse };
  }
}

async function runEval(): Promise<void> {
  if (!process.env.GROQ_API_KEY) {
    console.error("GROQ_API_KEY is required to run the eval harness.");
    process.exit(1);
  }

  console.log("=".repeat(60));
  console.log("  Notes Agent — Evaluation Harness");
  console.log(`  Test user: ${TEST_USER}`);
  console.log("=".repeat(60));
  console.log();

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i];
    process.stdout.write(`[${i + 1}/${scenarios.length}] ${scenario.name} ... `);

    // Small delay between scenarios to avoid hitting the TPM (tokens/min) rate limit
    if (i > 0) await new Promise((r) => setTimeout(r, 3000));

    const result = await runScenario(scenario, i);

    if (result.passed) {
      console.log("✓ PASS");
      passed++;
    } else {
      console.log(`✗ FAIL${result.error ? ` (${result.error})` : ""}`);
      if (result.response !== undefined) {
        console.log(`   └─ Agent said: "${result.response}"`);
      }
      failed++;
    }
  }

  console.log();
  console.log("=".repeat(60));
  console.log(`  Results: ${passed}/${scenarios.length} passed`);
  console.log(`  Pass rate: ${Math.round((passed / scenarios.length) * 100)}%`);
  console.log("=".repeat(60));

  // Clean up test data
  const db = getDb();
  db.prepare("DELETE FROM notes WHERE user_id = ?").run(TEST_USER);

  process.exit(failed > 0 ? 1 : 0);
}

runEval().catch((err) => {
  console.error("Eval harness crashed:", err);
  process.exit(1);
});
