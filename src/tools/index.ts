import {
  handleAddNote,
  handleSearchNotes,
  handleUpdateNote,
  handleDeleteNote,
  handleAnswerQuestion,
  handleSemanticSearch,
} from "./handlers";
import type {
  AddNoteInput,
  SearchNotesInput,
  UpdateNoteInput,
  DeleteNoteInput,
  AnswerQuestionInput,
  SemanticSearchInput,
} from "../types";

/**
 * Dispatches a tool call from Claude to the correct handler function.
 *
 * Claude returns a tool_use block with:
 *   - toolName: the name field from our schema (e.g. "add_note")
 *   - toolInput: a plain object matching that tool's input_schema
 *
 * This function routes to the right handler and returns the result as a string,
 * which gets sent back to Claude as a tool_result content block.
 *
 * @param toolName  - the name Claude selected
 * @param toolInput - the arguments Claude filled in (already parsed from JSON)
 * @param userId    - the current user (for multi-user isolation)
 */
export async function dispatchTool(
  toolName: string,
  toolInput: Record<string, unknown>,
  userId: string
): Promise<string> {
  switch (toolName) {
    case "add_note":
      return handleAddNote(toolInput as unknown as AddNoteInput, userId);

    case "search_notes":
      return handleSearchNotes(toolInput as unknown as SearchNotesInput, userId);

    case "update_note":
      return handleUpdateNote(toolInput as unknown as UpdateNoteInput, userId);

    case "delete_note":
      return handleDeleteNote(toolInput as unknown as DeleteNoteInput, userId);

    case "answer_question":
      return handleAnswerQuestion(toolInput as unknown as AnswerQuestionInput, userId);

    case "semantic_search_notes":
      return handleSemanticSearch(toolInput as unknown as SemanticSearchInput, userId);

    default:
      // This should never happen if Claude is only calling tools we defined,
      // but we handle it defensively.
      return `Unknown tool "${toolName}". No action was taken.`;
  }
}
