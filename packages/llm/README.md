# @magyarsportonline/llm

Vékony, valódi Anthropic SDK-wrapper (`createAnthropicClient`) + modell-tiering konstansok (`docs/architecture/07-scalability.md` §7.3) + hozzávetőleges (nem számlázási célú) költségbecslés.

`isLlmConfigured(apiKey)` dönti el, hogy egy hívó agent a valódi LLM-útvonalat vagy az ADR 0007-ben dokumentált, `ANTHROPIC_API_KEY` hiányában aktiválódó fallback módot használja — ez a csomag maga nem tartalmaz fallback-logikát, az minden agentben lokálisan, explicit elágazásként él (lásd `packages/agents`).
