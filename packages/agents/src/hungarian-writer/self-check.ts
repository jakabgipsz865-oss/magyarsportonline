import { MODEL_SELF_CHECK, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";
import type { WriterFact } from "./llm-writer.js";

const selfCheckResponseSchema = z.object({
  consistent: z.boolean(),
  issues: z.array(z.string()),
});

const SYSTEM_PROMPT = `Ellenőrző asszisztens vagy (docs/architecture/02-agents.md §2.5 önellenőrzés). Kapsz egy <tenyek> JSON tömböt és egy <szoveg> magyar hírszöveget.

Ellenőrizd: a <szoveg> MINDEN ténybeli állítása alátámasztható-e a <tenyek>-ben? Ha a szöveg olyat állít (szám, név, esemény), ami nincs a tényekben, az hiba.

A válaszod KIZÁRÓLAG egy JSON objektum legyen:
{"consistent": true|false, "issues": ["konkrét probléma leírása magyarul", ...]}
Ha nincs probléma: {"consistent": true, "issues": []}`;

export interface SelfCheckResult {
  consistent: boolean;
  issues: string[];
}

/** `null` means the check itself failed (LLM error / unparseable output) — callers should treat this conservatively (lower confidence), never as a pass. */
export async function selfCheckWithLlm(
  client: LlmClient,
  facts: WriterFact[],
  generatedText: string,
  recordCost: (usd: number | null | undefined) => void,
): Promise<SelfCheckResult | null> {
  const prompt = `<tenyek>\n${JSON.stringify(facts)}\n</tenyek>\n\n<szoveg>\n${generatedText}\n</szoveg>`;

  const response = await client.complete({
    model: MODEL_SELF_CHECK,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 512,
  });
  recordCost(response.costUsd);

  const jsonMatch = /\{[\s\S]*\}/.exec(response.text);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsedJson: unknown = JSON.parse(jsonMatch[0]);
    return selfCheckResponseSchema.parse(parsedJson);
  } catch {
    return null;
  }
}
