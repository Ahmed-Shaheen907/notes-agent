import { GoogleGenerativeAI, ChatSession } from "@google/generative-ai";
import { functionDeclarations } from "./tools/schemas";
import { dispatchTool } from "./tools/index";

// ─── System prompt ────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT =
  `You are a personal note-taking assistant. You help users create, search, update, delete, and reason over their notes through natural conversation.

Core rules:
- Always search for a note before trying to update or delete it (so you have the ID).
- If multiple notes match the user's description, list them and ask which one they mean. Never guess.
- For deletions: always call delete_note with confirmed=false first to show a confirmation prompt. Only call with confirmed=true after the user explicitly agrees.
- For ambiguous requests, ask a short clarifying question rather than assuming.
- When a search returns no results, say so clearly and suggest alternatives.
- Keep responses concise. Don't repeat note content back unless the user asked for it.`;

// ─── Session type ─────────────────────────────────────────────────────────────

/**
 * A Session wraps a Gemini ChatSession (which stores its own history internally)
 * and the userId so the agent knows whose notes to read/write.
 */
export interface Session {
  chat: ChatSession;
  userId: string;
}

/**
 * Creates a new conversation session.
 * Each web UI tab (or CLI run) gets its own Session so conversations don't mix.
 */
export function createSession(userId: string = "default"): Session {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_PROMPT,
    // Gemini wraps tool definitions in { functionDeclarations: [...] }
    tools: [{ functionDeclarations }],
  });

  const chat = model.startChat();
  return { chat, userId };
}

// ─── Agentic loop ─────────────────────────────────────────────────────────────

/**
 * Sends one user message and runs the agentic loop until the model replies.
 *
 * How the Gemini tool loop works:
 *  1. Send user message → model responds
 *  2. If response contains functionCall parts → execute each tool
 *  3. Send all results back as functionResponse parts → model responds again
 *  4. Repeat until the model returns only text (no more function calls)
 *
 * Gemini's ChatSession stores history internally, so we don't manage a
 * messages[] array manually like with OpenAI — the session object handles it.
 */
export async function runAgentTurn(
  session: Session,
  userMessage: string
): Promise<string> {
  // Send the user's message and get the initial response.
  let result = await session.chat.sendMessage(userMessage);

  // The agentic loop — keeps going while the model is calling tools.
  while (true) {
    const response = result.response;
    const parts = response.candidates?.[0]?.content?.parts ?? [];

    // Collect any function calls the model wants to make.
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length === 0) {
      // No tool calls — the model produced a final text answer.
      return response.text();
    }

    // Execute every tool the model requested, collect the results.
    const functionResponses = [];
    for (const part of functionCalls) {
      const { name, args } = part.functionCall!;

      const toolResult = await dispatchTool(
        name,
        args as Record<string, unknown>,
        session.userId
      );

      // Each result is wrapped in a functionResponse part.
      functionResponses.push({
        functionResponse: {
          name,
          response: { result: toolResult },
        },
      });
    }

    // Send all results back to the model so it can continue reasoning.
    result = await session.chat.sendMessage(functionResponses);
  }
}
