# @magyarsportonline/llm

LLM-kliens absztrakció (`docs/architecture/05-repo-structure.md`) — a Fact Verification és Hungarian Writer agentek (`docs/architecture/02-agents.md` §2.4, §2.5) ezen keresztül hívják az LLM-et.

- `LlmClient` — szűk interfész (`completeText`, `completeJson`), amit az agentek látnak; nem az Anthropic SDK-t közvetlenül (`docs/architecture/09-architecture-review.md` §4 szűk-interfész elve).
- `CloudflareWorkersAiLlmClient` — production Fact Extraction és Self Check a Workers AI API-n.
- `GeminiLlmClient` — a Final Hungarian Writer kliense; productionben a Google AI Studio provider-native végpontját a hitelesített Cloudflare AI Gatewayen keresztül hívja.
- `AnthropicLlmClient` — megtartott alternatív adapter, `@anthropic-ai/sdk`-ra épül.
- `FakeLlmClient` — teszt double, előre felsorakoztatott válaszokkal — ez teszi lehetővé az agent-logika egységtesztelését `ANTHROPIC_API_KEY` nélkül (ebben a fejlesztői környezetben nincs is elérhető kulcs).
- `NoLlmClient` — determinisztikus, hálózat nélküli adapter explicit `LLM_PROVIDER=none` helyi tesztmódhoz. Productionben ez a mód tilos, mert az eredeti forrásszöveget adná vissza magyar újraírás helyett.
- `MODEL_TIERS` — a modell-választás (extrakció/self-check: `claude-haiku-4-5`, végső magyar szövegezés: `claude-sonnet-5`) a költségoptimalizált tiering elve alapján (`02-agents.md` §2.5, teljes `model-router.ts` Fázis 12 feladat).
