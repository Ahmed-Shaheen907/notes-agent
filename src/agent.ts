import Anthropic from "@anthropic-ai/sdk";
import { tools } from "./tools/schemas";
import { dispatchTool } from "./tools/index";

// ─── System prompt ────────────────────────────────────────────────────────────

/**
 * The system prompt shapes Claude's personality and sets hard rules.
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
 * This is passed to every API call, so Claude always has the full context.
 *
 * Multi-turn awareness is "free" because of this: when the user says
 * "actually, add a deadline to that last note", Claude can see the previous
 * note creation in the messages array and knows which note to update.
 */
export type ConversationMessages = Anthropic.MessageParam[];

/** Creates a fresh, empty conversation. */
export function createConversation(): ConversationMessages {
  return [];
}

// ─── Main agent step ──────────────────────────────────────────────────────────

/**
 * Processes one user turn and returns Claude's final text response.
 *
 * This function implements the "agentic loop":
 *
 *   1. Add user message to the history array
 *   2. Call Claude with tools + full history
 *   3. If Claude calls a tool → execute it, add the result, go back to 2
 *   4. If Claude returns text → we're done, return that text
 *
 * The loop continues until Claude produces a final text response. In practice
 * most turns require 1–2 tool calls before Claude answers.
 *
 * @param messages - The running conversation history (mutated in place)
 * @param userMessage - The new message from the user
 * @param userId - Used for multi-user data isolation
 * @returns Claude's final natural-language reply
 */
export async function runAgentTurn(
  messages: ConversationMessages,
  userMessage: string,
  userId: string
): Promise<string> {
  const client = new Anthropic();

  // Add the user's message to the conversation history.
  messages.push({ role: "user", content: userMessage });

  // The agentic loop — keeps going until Claude stops calling tools.
  while (true) {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    // Add Claude's response to history so the next call has full context.
    messages.push({ role: "assistant", content: response.content });

    // Check why Claude stopped generating.
    if (response.stop_reason === "end_turn") {
      // Claude is done — extract the text from its response.
      const textBlock = response.content.find((b) => b.type === "text");
      return textBlock && textBlock.type === "text"
        ? textBlock.text
        : "(no response)";
    }

    if (response.stop_reason === "tool_use") {
      // Claude wants to call one or more tools. Execute them all, then loop.
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        // Execute the tool and capture its output.
        const result = await dispatchTool(
          block.name,
          block.input as Record<string, unknown>,
          userId
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      // Add all tool results to the history so Claude can see what happened.
      messages.push({ role: "user", content: toolResults });

      // Loop back — Claude will now read the tool results and continue.
      continue;
    }

    // Unexpected stop reason (e.g. max_tokens) — return whatever text we have.
    const textBlock = response.content.find((b) => b.type === "text");
    return textBlock && textBlock.type === "text"
      ? textBlock.text
      : "I ran out of space to respond. Please try rephrasing your request.";
  }
}
