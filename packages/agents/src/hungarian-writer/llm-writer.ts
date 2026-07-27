import { MODEL_WRITER, type LlmClient } from "@magyarsportonline/llm";
import { z } from "zod";

export interface WriterFact {
  factType: string;
  payload: unknown;
}

export interface WriterOutput {
  titleHu: string;
  leadHu: string;
  bodyHu: string;
  changeSummaryHu: string;
}

const writerResponseSchema = z.object({
  title: z.string().min(1),
  lead: z.string().min(1),
  body: z.string().min(1),
  changeSummary: z.string().min(1),
});

/**
 * The Hungarian Writer Agent NEVER sees raw source text — only the
 * structured `<tenyek>` (facts) JSON, which is the main hallucination /
 * accidental-verbatim-translation defense from
 * docs/architecture/02-agents.md §2.5.
 */
const SYSTEM_PROMPT = `Magyar sportújságíró asszisztens vagy. A <tenyek> tag között JSON tömbként kapod meg egy sportesemény VERIFIKÁLT tényeit.

Feladatod: ezekből ÖNÁLLÓ MEGFOGALMAZÁSÚ, magyar nyelvű hírt írni. Ez SOSEM fordítás — saját mondatszerkezetet, saját megfogalmazást használj.

Szabályok:
- KIZÁRÓLAG a <tenyek>-ben szereplő tényeket használhatod. Semmit nem tehetsz hozzá, nem feltételezhetsz, nem told ki.
- Szó szerinti idézetet csak akkor használj, ha "quote" típusú tény explicit tartalmazza — ilyenkor idézőjelben, a payload "speaker" mezőjében megadott néven hivatkozva rá.
- Ha frissítésről van szó, a "changeSummary" mezőben magyarul foglald össze, mi új ehhez a Story korábbi verziójához képest.

A válaszod KIZÁRÓLAG egy JSON objektum legyen, más szöveg nélkül:
{"title": "...", "lead": "...", "body": "...", "changeSummary": "..."}`;

export async function generateWithLlm(
  client: LlmClient,
  facts: WriterFact[],
  isUpdate: boolean,
  recordCost: (usd: number | null | undefined) => void,
): Promise<WriterOutput | null> {
  const prompt = `<tenyek>\n${JSON.stringify(facts)}\n</tenyek>\n\n${
    isUpdate
      ? "Ez egy MEGLÉVŐ Story frissítése — a korábbi verzióhoz képesti újdonságokat foglald össze a changeSummary mezőben."
      : "Ez egy vadonatúj Story — a changeSummary mezőben egy rövid, semleges összefoglaló mondat is elég (pl. 'Kezdeti hír a rendelkezésre álló tények alapján.')."
  }`;

  const response = await client.complete({
    model: MODEL_WRITER,
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 1536,
  });
  recordCost(response.costUsd);

  const jsonMatch = /\{[\s\S]*\}/.exec(response.text);
  if (!jsonMatch) {
    return null;
  }

  try {
    const parsedJson: unknown = JSON.parse(jsonMatch[0]);
    const parsed = writerResponseSchema.parse(parsedJson);
    return {
      titleHu: parsed.title,
      leadHu: parsed.lead,
      bodyHu: parsed.body,
      changeSummaryHu: parsed.changeSummary,
    };
  } catch {
    return null;
  }
}
