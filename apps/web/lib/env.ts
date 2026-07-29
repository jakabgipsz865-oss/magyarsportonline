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
 * Per docs/adr/0004-phase-0-env-vars-optional.md: each variable becomes
 * `required()` in the phase that actually wires it to real functionality,
 * not before. `DATABASE_URL`, `ANTHROPIC_API_KEY`, and `CRON_SECRET` made
 * that transition with the MVP end-to-end pipeline (lib/db.ts, lib/llm.ts,
 * app/api/internal/cron/dispatch-ingest) — the remaining variables below
 * are still ahead of their wiring and stay optional.
 */
export const env = createEnv({
  server: {
    // Wired: packages/db kliens (lib/db.ts).
    DATABASE_URL: z.string().url(),

    // LLM_PROVIDER=none (alapértelmezés) esetén a pipeline a determinisztikus
    // NoLlmClient adaptert használja (packages/llm/src/no-llm-client.ts) —
    // nincs API-hívás, nincs költség, semmilyen API-kulcs nem szükséges.
    // LLM_PROVIDER=cloudflare esetén CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN,
    // LLM_PROVIDER=anthropic esetén ANTHROPIC_API_KEY, LLM_PROVIDER=gemini
    // esetén GEMINI_API_KEY kötelező — ezt a feltételes kényszert lib/llm.ts
    // ellenőrzi (createEnv nem támogat egyszerűen mező-közti feltételes
    // validációt). Jelenlegi (2026-07) döntés: Cloudflare Workers AI az
    // aktív teszt-provider — a Gemini és Anthropic adapter megmarad, de
    // egyik sincs bekapcsolva (lásd docs/infrastructure-setup.md).
    LLM_PROVIDER: z.enum(["none", "anthropic", "gemini", "cloudflare"]).default("none"),

    // Csak akkor kötelező ténylegesen, ha LLM_PROVIDER=cloudflare (lib/llm.ts).
    // Cloudflare Dashboard → jobb felső saroktól jobbra → Account ID.
    CLOUDFLARE_ACCOUNT_ID: z.string().min(1).optional(),

    // Csak akkor kötelező ténylegesen, ha LLM_PROVIDER=cloudflare (lib/llm.ts).
    // "Workers AI" jogosultságú API-token (Cloudflare Dashboard → My Profile
    // → API Tokens) — kizárólag szerveroldalon (apps/web/lib/llm.ts) kerül
    // felhasználásra, sosem jut a kliens-oldali bundle-be (lásd `client: {}`
    // lent). Ingyenes napi Neuron-kerettel használható, nem igényel
    // Cloudflare Paid plant vagy bekapcsolt billinget.
    CLOUDFLARE_API_TOKEN: z.string().min(1).optional(),

    // Cloudflare JSON Mode-ot hivatalosan támogató modell. Az adapter a
    // korábbi/hibás, strukturált kimenetet nem támogató env-értéket is erre
    // a fail-safe alapmodellre cseréli.
    CLOUDFLARE_AI_MODEL: z.string().min(1).default("@cf/meta/llama-3.3-70b-instruct-fp8-fast"),

    // Csak akkor kötelező ténylegesen, ha LLM_PROVIDER=anthropic (lib/llm.ts).
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    // Csak akkor kötelező ténylegesen, ha LLM_PROVIDER=gemini (lib/llm.ts).
    // Ingyenes tier — a Google AI Studio-ban generálható API kulcs, nem
    // igényel fizetős Google Cloud billinget.
    GEMINI_API_KEY: z.string().min(1).optional(),

    // Ingyenes tierben elérhető, stabil Flash-Lite modell alapértelmezésben
    // (packages/llm/src/gemini-client.ts) — kód nélkül felülírható, ha
    // Google időközben megváltoztatja a free-tier kínálatot.
    GEMINI_MODEL: z.string().min(1).default("gemini-2.0-flash-lite"),

    // A futó alkalmazás havi Anthropic-költségplafonja USD-ben — elérésekor
    // a Budget Guard automatikusan No-LLM módra vált (packages/llm/src/budget-guard.ts),
    // a pipeline nem áll le.
    LLM_MONTHLY_BUDGET_USD: z.coerce.number().positive().default(5),

    // Admin/review felület (/admin/review) HTTP Basic auth jelszava.
    // Ha nincs beállítva, az admin felület 503-mal letiltva marad —
    // titok sosem kerül kódba, csak env-be.
    ADMIN_SECRET: z.string().min(8).optional(),

    // A publikus site kanonikus origin-je (SEO: canonical URL, sitemap,
    // JSON-LD, RSS). Vercel-en alapértelmezésként a production URL.
    SITE_URL: z.string().url().default("https://magyarsportonline-web.vercel.app"),

    // Content Quality & Reliability Hardening sprint operational kill switch
    // (packages/agents/publish-gate/rule.ts, roadmap Fázis 9 "soft launch"
    // FORCE_REVIEW_MODE-ja, most bevezetve): amíg "true" (az alapértelmezés,
    // NEM igényel Vercel env-beállítást), a Publish Gate MINDEN Story-t
    // review queue-ba küld, függetlenül a confidence/risk/quality
    // eredményétől — auto-publish nincs. Csak explicit
    // FORCE_REVIEW_MODE=false esetén tér vissza a normál, confidence-alapú
    // döntéshez.
    FORCE_REVIEW_MODE: z
      .enum(["true", "false"])
      .default("true")
      .transform((value) => value === "true"),

    // Wired: /api/internal/cron/dispatch-ingest — Vercel Cron "Authorization: Bearer $CRON_SECRET" konvenció (docs/architecture/04-api-spec.md §4.3, 06-deployment.md §6.5).
    CRON_SECRET: z.string().min(1),

    // Fázis 2+ (a jelenlegi in-process dispatcher helyett valódi Inngest-kötés, lásd docs/adr/0005-mvp-end-to-end-scope-cuts.md)
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
