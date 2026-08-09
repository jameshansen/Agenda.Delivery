/**
 * Next.js instrumentation — runs once when the server starts.
 *
 * Validates environment variables and starts the agent scheduler so
 * agents run autonomously on a cadence.
 */

export async function register() {
  // Only run on the Node.js server (not in edge runtime).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warnIfEnvMissing } = await import("./lib/env");
    warnIfEnvMissing();
    // Scheduling + agent execution now live in the orchestrator container.
    // The UI is a read-only DB reader; it no longer runs agents in-process.
  }
}