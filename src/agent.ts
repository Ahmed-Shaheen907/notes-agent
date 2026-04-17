import OpenAI from "openai";
import { tools } from "./tools/schemas";
import { dispatchTool } from "./tools/index";

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  const today = new Date().toISOString().slice(0, 10); // e.g. "2026-04-17"
  const now   = new Date().toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" });

  return `You are a personal note-taking assistant. You help users create, search, update, delete, and reason over their notes through natural conversation.

Today's date: ${today} (${now}). Use this to interpret relative terms like "today", "this week", "upcoming", and to rank notes by deadline proximity.

Core rules:
- Always search for a note before trying to update or delete it (so you have the ID).
- If multiple notes match the user's description, list them and ask which one they mean. Never guess.
- For deletions: always call delete_note with confirmed=false first to show a confirmation prompt. Only call with confirmed=true after the user explicitly agrees.
- For ambiguous requests, ask a short clarifying question rather than assuming.
- Keep responses concise. Don't repeat note content back unless the user asked for it.
- When the user says "save", "create", "add", "record", or "write" a note: call add_note immediately. Do NOT search first — this is a new note, not a modification.
- Only search before update_note or delete_note operations. If the user's intent is clearly to modify or delete an existing note and they reference it by pronoun ("that note", "it", "the last one"), search for it first to get the ID.

Urgency & deadline rules:
- When the user asks for "urgent", "important", "due soon", or "deadline" notes: ALWAYS run TWO searches — one by tag (tags: ["urgent"]) AND one by keyword (query: "deadline"). Then combine and present both sets of results, sorted with the soonest deadlines first.
- If a tag search returns nothing, do NOT stop — always also try a keyword search before telling the user nothing was found.
- When displaying notes with deadlines, highlight which ones are due today, overdue, or coming up soon relative to today's date (${today}).
- Never tell the user "no results" after only one search attempt when the request involves urgency or deadlines.`;
}

// ─── Groq client (OpenAI-compatible) ─────────────────────────────────────────

/**
 * Groq is a free, fast LLM API that uses the same request/response format as
 * OpenAI. We point the OpenAI SDK at Groq's base URL and it just works.
 *
 * Get a free API key at: https://console.groq.com
 */
const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY ?? "",
  baseURL: "https://api.groq.com/openai/v1",
});

const MODEL = "openai/gpt-oss-20b";

// ─── Session type ─────────────────────────────────────────────────────────────

/**
 * A Session holds the full conversation history for one browser tab.
 * We manage the messages[] array manually (unlike Gemini's ChatSession which
 * did it internally). Each API call gets the full array so the model has
 * complete context — this is how multi-turn conversation works.
 */
export interface Session {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  userId: string;
}

/**
 * Creates a new conversation session with the system prompt pre-loaded.
 */
export function createSession(userId: string = "default"): Session {
  return {
    messages: [{ role: "system", content: buildSystemPrompt() }],
    userId,
  };
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

/**
 * Sends one user message and runs the agentic loop until the model replies
 * with text (no more tool calls).
 *
 * How the tool use loop works:
 *  1. Add user message to history, call the API
 *  2. If the model returns tool_calls → execute each tool, add results to history
 *  3. Call the API again with the updated history
 *  4. Repeat until the model returns a plain text response
 *
 * The messages[] array is the memory — every call sees the full conversation.
 */
export async function runAgentTurn(
  session: Session,
  userMessage: string
): Promise<string> {
  // Add the user's message to the conversation history
  session.messages.push({ role: "user", content: userMessage });

  // Agentic loop — keeps going while the model is calling tools
  while (true) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages: session.messages,
      tools,
      tool_choice: "auto",
    });

    const message = response.choices[0].message;

    // Add the model's response to history (important — includes tool_calls metadata)
    session.messages.push(message);

    // No tool calls → the model produced a final text answer
    if (!message.tool_calls || message.tool_calls.length === 0) {
      return message.content ?? "";
    }

    // Execute every tool the model requested, then add results to history
    for (const toolCall of message.tool_calls) {
      if (toolCall.type !== "function") continue;

      const toolResult = await dispatchTool(
        toolCall.function.name,
        JSON.parse(toolCall.function.arguments) as Record<string, unknown>,
        session.userId
      );

      // Tool results go back as "tool" role messages, matched by tool_call_id
      session.messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        content: toolResult,
      });
    }

    // Loop back — the model will read the tool results and either call more
    // tools or produce its final answer
  }
}
