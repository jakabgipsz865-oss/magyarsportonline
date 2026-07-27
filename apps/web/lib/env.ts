import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

/**
 * Validated, typed environment access — importing `env` throws immediately
 * (at module load, so at boot/build time, not deep inside a request
 * handler) if a required variable is missing or malformed. Never read
 * `process.env.X` directly anywhere else in `apps/web`.
 *
 * Every variable below is documented in `.env.example`. Secrets NEVER get a
 * default value here — a missing secret must fail loudly, not silently fall
 * back to something that looks like it works
 * (docs/architecture/06-deployment.md §6.6).
 *
 * Fázis 0-ban egyik változó sem volt `required()` (lásd
 * docs/adr/0004-phase-0-env-vars-optional.md) — az ADR saját maga mondta ki
 * a következményt: "minden változó a saját roadmap-fázisában válik
 * kötelezővé, amikor ténylegesen bekötésre kerül". A `DATABASE_URL` az MVP
 * pipeline-nal (Story oldal, `apps/web/lib/stories.ts`) ténylegesen
 * bekötésre került, ezért itt már kötelező — hiányában a build/dev/start
 * azonnal, egyértelmű hibával áll le, nem egy request közepén derül ki.
 */
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),

    // Fázis 6+ (Hungarian Writer Agent és a többi LLM-hívó agent)
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    // Fázis 2+ (event bus bekötése)
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),

    // Fázis 11+ (Social Media Agent)
    META_GRAPH_API_TOKEN: z.string().min(1).optional(),
    X_API_BEARER_TOKEN: z.string().min(1).optional(),

    // Fázis 10+ (Admin Review UI hitelesítés)
    NEXTAUTH_SECRET: z.string().min(1).optional(),

    // Elérhető már Fázis 0-tól — a strukturált logger szintje
    // (@magyarsportonline/observability), biztonságos alapértelmezéssel.
    LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  },
  client: {},
  experimental__runtimeEnv: {},
});
