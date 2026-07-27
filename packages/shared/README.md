# @magyarsportonline/shared

Megosztott, keretrendszer-független TypeScript típusok és konstansok, amiket `apps/web`, `packages/events` és `packages/db` egyaránt használ — így az állapotgép/enum-értékek (`StoryStatus`, `RiskLevel`, stb., forrás: `docs/architecture/01-data-model.md`) egyetlen helyen vannak definiálva, nem duplikálva csomagonként.
