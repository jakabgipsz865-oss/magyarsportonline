/**
 * Runs once at server boot (Next.js instrumentation hook). Importing
 * `./lib/env` here forces the Zod validation in that module to execute at
 * startup — a malformed/missing required env var fails the boot
 * immediately, rather than surfacing as a confusing runtime error deep
 * inside whichever request handler happens to touch it first.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] === "nodejs") {
    await import("./lib/env");
  }
}
