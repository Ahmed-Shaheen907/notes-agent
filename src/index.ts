import "dotenv/config";
import * as readline from "readline";
import { createSession, runAgentTurn } from "./agent";

// ─── Multi-user: read userId from CLI args or env ─────────────────────────────

/**
 * Usage:  npm run dev [-- --user alice]
 *
 * Passing --user <id> scopes all notes to that user so multiple people can
 * share the same database without seeing each other's notes.
 *
 * In a real deployment you'd get the user ID from a JWT or session token.
 * Here we accept it as a CLI flag or environment variable for simplicity.
 */
function resolveUserId(): string {
  const args = process.argv.slice(2);
  const userFlagIndex = args.indexOf("--user");
  if (userFlagIndex !== -1 && args[userFlagIndex + 1]) {
    return args[userFlagIndex + 1];
  }
  return process.env.DEFAULT_USER ?? "default";
}

// ─── Entry point ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Validate that the required API key is present before doing anything.
  if (!process.env.GEMINI_API_KEY) {
    console.error("Error: GEMINI_API_KEY is not set.");
    console.error("Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  const userId = resolveUserId();
  const session = createSession(userId);

  // Set up the terminal readline interface.
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false, // Keeps prompts clean when piping input (useful in eval)
  });

  console.log("╔══════════════════════════════════════╗");
  console.log("║      Notes Agent  (type /quit to exit)      ║");
  console.log("╚══════════════════════════════════════╝");
  if (userId !== "default") {
    console.log(`User: ${userId}`);
  }
  console.log();

  // Prompt the user and wait for input in a loop.
  const prompt = (): void => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        prompt(); // Ignore empty lines
        return;
      }

      // Allow the user to exit cleanly.
      if (trimmed === "/quit" || trimmed === "/exit" || trimmed === "exit") {
        console.log("\nGoodbye!");
        rl.close();
        process.exit(0);
      }

      try {
        process.stdout.write("Agent: ");
        const response = await runAgentTurn(session, trimmed);
        console.log(response);
        console.log(); // Blank line between turns for readability
      } catch (err) {
        console.error(`\nError: ${String(err)}\n`);
      }

      prompt(); // Loop back for the next message
    });
  };

  prompt();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
