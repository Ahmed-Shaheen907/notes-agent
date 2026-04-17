import OpenAI from "openai";
import { tools } from "./tools/schemas";
import { dispatchTool } from "./tools/index";

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * The system prompt shapes the model's personality and sets hard rules.
 * Keeping it concise but specific produces more consistent behaviour than
 * a long, vague set of instructions.
 */
const SYSTEM_PROMPT = `You are a personal note-taking assistant. You help users create, search, update, delete, and reason over their notes through natural conversation.

Core rules:
- Always search for a note before trying to update or delete it (so you have the ID).
- If multiple notes match the user's description, list them and ask which one they mean. Never guess.
- For deletions: always call delete_note with confirmed=false first to show a confirmation prompt. Only call with confirmed=true after the user explicitly agrees.
- For ambiguous requests, ask a short clarifying question rather than assuming.
- When a search returns no results, say so clearly and suggest alternatives (e.g. broaden the keyword, check tag spelling).
- Keep responses concise. Don't repeat note content back to the user unless they asked for it.
- You have access to semantic_search_notes for queries that require meaning-based matching rather than exact keyword matching.`;

// ─── Conversation state ───────────────────────────────────────────────────────

/**
 * The conversation state is a simple array of messages.
 * This is passed to every API call, so the model always has the full context.
 *
 * Multi-turn awareness is "free" because of this: when the user says
 * "actually, add a deadline to that last note", the model can see the previous
 * note creation in the messages array and knows which note to update.
 */
export type ConversationMessages = OpenAI.ChatCompletionMessageParam[];

/** Creates a fresh conversation with just the system prompt. */
export function createConversation(): ConversationMessages {
  return [{ role: "system", content: SYSTEM_PROMPT }];
}

// ─── Main agent step ──────────────────────────────────────────────────────────

/**
 * Processes one user turn and returns the model's final text response.
 *
 * This function implements the "agentic loop":
 *
 *   1. Add user message to the history array
 *   2. Call the model with tools + full history
 *   3. If the model calls a tool → execute it, add the result, go back to 2
 *   4. If the model returns text → we're done, return that text
 *
 * The loop continues until the model produces a final text response. In practice
 * most turns require 1–2 tool calls before the model answers.
 *
 * OpenAI difference from Anthropic:
 *  - Tool arguments arrive as a JSON STRING (not an object) — we must JSON.parse them.
 *  - Tool results are added as { role: "tool", tool_call_id, content } messages.
 *  - The finish_reason is "tool_calls" (not "tool_use").
 *
 * @param messages - The running conversation history (mutated in place)
 * @param userMessage - The new message from the user
 * @param userId - Used for multi-user data isolation
 * @returns The model's final natural-language reply
 */
export async function runAgentTurn(
  messages: ConversationMessages,
  userMessage: string,
  userId: string
): Promise<string> {
  const client = new OpenAI();

  // Add the user's message to the conversation history.
  messages.push({ role: "user", content: userMessage });

  // The agentic loop — keeps going until the model stops calling tools.
  while (true) {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      tools,
      messages,
    });

    const choice = response.choices[0];

    // Add the assistant's response to history so the next call has full context.
    messages.push(choice.message);

    if (choice.finish_reason === "stop") {
      // Model is done — return its text content.
      return choice.message.content ?? "(no response)";
    }

    if (choice.finish_reason === "tool_calls") {
      // Model wants to call one or more tools. Execute them all, then loop.
      const toolCalls = choice.message.tool_calls ?? [];

      for (const toolCall of toolCalls) {
        // OpenAI sends arguments as a JSON string — parse it into an object.
        // We narrow the type to the standard function tool call shape.
        if (toolCall.type !== "function") continue;
        const toolInput = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;

        const result = await dispatchTool(
          toolCall.function.name,
          toolInput,
          userId
        );

        // Each tool result is its own message with role "tool".
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: result,
        });
      }

      // Loop back — the model will now read the tool results and continue.
      continue;
    }

    // Unexpected finish reason (e.g. length) — return whatever text we have.
    return choice.message.content ?? "I ran out of space to respond. Please try rephrasing your request.";
  }
}
