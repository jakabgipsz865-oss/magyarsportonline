import pino from "pino";
import type { AgentLogContext } from "./context.js";

/**
 * Deliberately narrow interface — callers only ever get `info`/`warn`/
 * `error` plus `child`, never the full pino API. This is the actual
 * "observability boundary" the review asked for
 * (docs/architecture/09-architecture-review.md §10,
 * docs/architecture/06-deployment.md §6.8): agents log through this
 * interface only, so swapping the destination (stdout today, an
 * Axiom/Better Stack/Datadog transport in Fázis 13,
 * docs/architecture/08-roadmap.md 103. lépés) never touches call sites.
 *
 * This is explicitly NOT a replacement for the `agent_runs` Postgres table
 * (@magyarsportonline/db) — that table stays as a thin, queryable summary;
 * this logger is where the verbose, per-run detail goes instead of into
 * that OLTP table (the exact problem the review flagged in §6).
 */
export interface Logger {
  info(context: AgentLogContext, message: string): void;
  warn(context: AgentLogContext, message: string): void;
  error(context: AgentLogContext, message: string): void;
  child(bindings: Partial<AgentLogContext>): Logger;
}

export interface CreateLoggerOptions {
  level?: "trace" | "debug" | "info" | "warn" | "error" | "fatal";
  /** Injectable write destination — used by tests; defaults to stdout. */
  destination?: NodeJS.WritableStream;
}

class PinoLogger implements Logger {
  constructor(private readonly instance: pino.Logger) {}

  info(context: AgentLogContext, message: string): void {
    this.instance.info(context, message);
  }

  warn(context: AgentLogContext, message: string): void {
    this.instance.warn(context, message);
  }

  error(context: AgentLogContext, message: string): void {
    this.instance.error(context, message);
  }

  child(bindings: Partial<AgentLogContext>): Logger {
    return new PinoLogger(this.instance.child(bindings));
  }
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  const instance = options.destination
    ? pino({ level: options.level ?? "info" }, options.destination)
    : pino({ level: options.level ?? "info" });
  return new PinoLogger(instance);
}

/** Binds `agentName` once so every subsequent call site cannot forget it. */
export function createAgentLogger(base: Logger, agentName: string): Logger {
  return base.child({ agentName });
}
