# @magyarsportonline/observability

A strukturált logolási **határ** (docs/architecture/09-architecture-review.md §10, docs/architecture/06-deployment.md §6.8): agentek ezen a szűk `Logger` interfészen keresztül logolnak, sosem közvetlenül `pino`-t vagy `console`-t hívva.

## Miért külön csomag már Fázis 0-ban?

A review egyik legfontosabb korrekciója, hogy a nyers, per-agent-futás naplózás **nem** a Postgres `agent_runs` táblába megy (lásd `packages/db/src/schema/agent-runs.ts` kommentjét) — ez a csomag a tényleges célhely. Fázis 0-ban a kimenet stdout-ra megy JSON-formátumban; Fázis 13-ban (`docs/architecture/08-roadmap.md`, 103. lépés) ugyanezen `Logger`-interfész mögé kerül egy külső observability-rendszer (Axiom/Better Stack/Datadog) transportja — a hívási helyek (agentek) kódját ez nem érinti.

## Használat

```ts
import { createLogger, createAgentLogger } from "@magyarsportonline/observability";

const base = createLogger({ level: "info" });
const logger = createAgentLogger(base, "fact-verification");

logger.info({ storyId, correlationId }, "confidence score recalculated");
```
