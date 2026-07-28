import type { Metadata } from "next";
import { factVerification } from "@magyarsportonline/agents";
import type {
  Fact,
  Story,
  StoryCredibilityHistoryRow,
  StorySourceWithMeta,
} from "@magyarsportonline/db";
import { revalidatePath } from "next/cache";
import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";

// Sosem indexelhető — belső, ADMIN_SECRET-tel védett review felület
// (2026-07-28-i "Hitelességi mutató" sprint, prioritás #3: "Admin oldalon a
// Story forrásainak, állításainak és hitelességi pontjának
// szerkeszthetősége"). Lásd app/robots.ts (/internal/ disallow) és
// middleware.ts (HTTP Basic auth, /internal/:path* matcher).
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

// DB-driven admin nézet — sosem prerendelt, mindig friss.
export const dynamic = "force-dynamic";

const RECENT_STORIES_LIMIT = 50;

interface PageProps {
  searchParams: Promise<{ storyId?: string }>;
}

const PATH = "/internal/credibility-review";

function reasonOf(formData: FormData): string | null {
  const reason = formData.get("reason");
  return typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : null;
}

/** Egy forrás kizárása/visszavétele a Story hitelesség-számításából, majd újraszámolás. */
async function toggleSourceExclusionAction(formData: FormData): Promise<void> {
  "use server";
  const storyId = formData.get("storyId");
  const rawArticleId = formData.get("rawArticleId");
  const excluded = formData.get("excluded") === "true";
  if (typeof storyId !== "string" || typeof rawArticleId !== "string") {
    return;
  }
  const repos = createRepositories();
  await repos.storySourceRepository.setExcluded(
    storyId,
    rawArticleId,
    excluded,
    reasonOf(formData),
  );
  await factVerification.recomputeCredibilityForStory(
    {
      factRepository: repos.factRepository,
      storySourceRepository: repos.storySourceRepository,
      storyRepository: repos.storyRepository,
      storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
    },
    storyId,
  );
  revalidatePath(PATH);
}

/** Egy állítás (claim) kizárása/visszavétele, majd újraszámolás. */
async function toggleFactExclusionAction(formData: FormData): Promise<void> {
  "use server";
  const storyId = formData.get("storyId");
  const factId = formData.get("factId");
  const excluded = formData.get("excluded") === "true";
  if (typeof storyId !== "string" || typeof factId !== "string") {
    return;
  }
  const repos = createRepositories();
  await repos.factRepository.setExcluded(factId, excluded, reasonOf(formData));
  await factVerification.recomputeCredibilityForStory(
    {
      factRepository: repos.factRepository,
      storySourceRepository: repos.storySourceRepository,
      storyRepository: repos.storyRepository,
      storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
    },
    storyId,
  );
  revalidatePath(PATH);
}

/** Egy állítás magyar szövegének (payload.detail_hu) javítása. */
async function editFactDetailAction(formData: FormData): Promise<void> {
  "use server";
  const factId = formData.get("factId");
  const detailHu = formData.get("detailHu");
  if (typeof factId !== "string" || typeof detailHu !== "string" || detailHu.trim().length === 0) {
    return;
  }
  const repos = createRepositories();
  await repos.factRepository.updateDetail(factId, detailHu.trim());
  revalidatePath(PATH);
}

/** Ugyanazzal a képlettel újraszámolja a hitelességi pontot a JELENLEGI (kizárásokat figyelembe vevő) adatokból. */
async function recomputeCredibilityAction(formData: FormData): Promise<void> {
  "use server";
  const storyId = formData.get("storyId");
  if (typeof storyId !== "string") {
    return;
  }
  const repos = createRepositories();
  await factVerification.recomputeCredibilityForStory(
    {
      factRepository: repos.factRepository,
      storySourceRepository: repos.storySourceRepository,
      storyRepository: repos.storyRepository,
      storyCredibilityHistoryRepository: repos.storyCredibilityHistoryRepository,
    },
    storyId,
  );
  revalidatePath(PATH);
}

/** Közvetlen admin felülbírálás — a számított pontszám helyett egy szerkesztő direktben állítja be. */
async function overrideCredibilityAction(formData: FormData): Promise<void> {
  "use server";
  const storyId = formData.get("storyId");
  const scoreRaw = formData.get("score");
  const labelHu = formData.get("labelHu");
  const justificationHu = formData.get("justificationHu");
  if (
    typeof storyId !== "string" ||
    typeof scoreRaw !== "string" ||
    typeof labelHu !== "string" ||
    typeof justificationHu !== "string" ||
    labelHu.trim().length === 0
  ) {
    return;
  }
  const score = Math.min(100, Math.max(0, Math.round(Number(scoreRaw))));
  if (Number.isNaN(score)) {
    return;
  }
  const repos = createRepositories();
  const story = await repos.storyRepository.getById(storyId);
  const result = {
    score,
    band: story?.credibilityBand ?? "manual_override",
    labelHu: labelHu.trim(),
    justificationHu: justificationHu.trim(),
    officialConfirmed: story?.credibilityOfficialConfirmed ?? false,
    corroboratingSourceCount: story?.credibilityCorroboratingCount ?? 0,
  };
  await repos.storyRepository.updateCredibilityResult(storyId, result);
  await repos.storyCredibilityHistoryRepository.insert({
    ...result,
    storyId,
    source: "manual_override",
  });
  revalidatePath(PATH);
}

const chipStyle: React.CSSProperties = {
  fontSize: "0.75em",
  padding: "2px 8px",
  borderRadius: 999,
  marginRight: 6,
  display: "inline-block",
};

function CredibilitySummary({ story }: { story: Story }): ReactNode {
  if (story.credibilityScore === null) {
    return <p style={{ color: "#777" }}>Még nincs kiszámolt hitelességi pontszám.</p>;
  }
  return (
    <div style={{ background: "#fafafa", borderRadius: 6, padding: 12, marginBottom: 12 }}>
      <p style={{ margin: 0 }}>
        <strong>{story.credibilityLabelHu}</strong> ({story.credibilityScore}/100)
      </p>
      <p style={{ fontSize: "0.9em", color: "#555" }}>{story.credibilityJustificationHu}</p>
      <p style={{ fontSize: "0.85em", color: "#777" }}>
        {story.credibilityCorroboratingCount ?? 0} megerősítő forrás · Hivatalos megerősítés:{" "}
        {story.credibilityOfficialConfirmed ? "igen" : "nem"} · Utolsó frissítés:{" "}
        {story.credibilityUpdatedAt?.toLocaleString("hu-HU") ?? "n/a"}
      </p>
    </div>
  );
}

function SourceRow({
  storyId,
  source,
}: {
  storyId: string;
  source: StorySourceWithMeta;
}): ReactNode {
  return (
    <li style={{ marginBottom: 10, opacity: source.excluded ? 0.5 : 1 }}>
      <strong>{source.sourceName}</strong>{" "}
      <span style={chipStyle}>{source.reliabilityTier} tier</span>
      {source.category ? <span style={chipStyle}>{source.category}</span> : null}
      <span style={chipStyle}>{source.contributionType}</span>
      {source.excluded ? (
        <span style={{ ...chipStyle, background: "#fdecea", color: "#b3261e" }}>
          kizárva{source.excludedReason ? `: ${source.excludedReason}` : ""}
        </span>
      ) : null}
      <form
        action={toggleSourceExclusionAction}
        style={{ display: "inline-flex", gap: 6, marginLeft: 8 }}
      >
        <input type="hidden" name="storyId" value={storyId} />
        <input type="hidden" name="rawArticleId" value={source.rawArticleId} />
        <input type="hidden" name="excluded" value={source.excluded ? "false" : "true"} />
        {!source.excluded && (
          <input
            type="text"
            name="reason"
            placeholder="indoklás"
            style={{ fontSize: "0.8em", padding: "2px 4px" }}
          />
        )}
        <button type="submit" style={{ fontSize: "0.75em" }}>
          {source.excluded ? "Visszavétel" : "Kizárás"}
        </button>
      </form>
    </li>
  );
}

function FactRow({ storyId, fact }: { storyId: string; fact: Fact }): ReactNode {
  const detailHu =
    typeof fact.payload === "object" && fact.payload !== null && "detail_hu" in fact.payload
      ? String((fact.payload as { detail_hu: unknown }).detail_hu ?? "")
      : "";
  return (
    <li style={{ marginBottom: 12, opacity: fact.excluded ? 0.5 : 1 }}>
      <span style={chipStyle}>{fact.factType}</span>
      <span style={chipStyle}>{fact.corroborationCount}× megerősítve</span>
      {fact.isContradicted ? (
        <span style={{ ...chipStyle, background: "#fdecea", color: "#b3261e" }}>ellentmondó</span>
      ) : null}
      {fact.excluded ? (
        <span style={{ ...chipStyle, background: "#fdecea", color: "#b3261e" }}>
          kizárva{fact.excludedReason ? `: ${fact.excludedReason}` : ""}
        </span>
      ) : null}
      <form action={editFactDetailAction} style={{ display: "flex", gap: 6, marginTop: 4 }}>
        <input type="hidden" name="factId" value={fact.id} />
        <textarea
          name="detailHu"
          defaultValue={detailHu}
          rows={1}
          style={{ flex: 1, fontSize: "0.85em", padding: "3px 5px" }}
        />
        <button type="submit" style={{ fontSize: "0.75em" }}>
          Mentés
        </button>
      </form>
      <form
        action={toggleFactExclusionAction}
        style={{ display: "inline-flex", gap: 6, marginTop: 4 }}
      >
        <input type="hidden" name="storyId" value={storyId} />
        <input type="hidden" name="factId" value={fact.id} />
        <input type="hidden" name="excluded" value={fact.excluded ? "false" : "true"} />
        {!fact.excluded && (
          <input
            type="text"
            name="reason"
            placeholder="indoklás"
            style={{ fontSize: "0.8em", padding: "2px 4px" }}
          />
        )}
        <button type="submit" style={{ fontSize: "0.75em" }}>
          {fact.excluded ? "Visszavétel" : "Kizárás"}
        </button>
      </form>
    </li>
  );
}

function CredibilityHistoryList({ history }: { history: StoryCredibilityHistoryRow[] }): ReactNode {
  if (history.length === 0) {
    return null;
  }
  return (
    <details style={{ marginTop: 12 }}>
      <summary style={{ cursor: "pointer", fontSize: "0.85em", color: "#0645ad" }}>
        Hitelességi változások története ({history.length})
      </summary>
      <ul style={{ fontSize: "0.85em" }}>
        {history.map((entry) => (
          <li key={entry.id}>
            {entry.recordedAt.toLocaleString("hu-HU")} — {entry.labelHu} ({entry.score}/100)
            {entry.source === "manual_override" ? " · admin felülbírálás" : ""}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function CredibilityReviewPage({
  searchParams,
}: PageProps): Promise<ReactNode> {
  const { storyId: requestedStoryId } = await searchParams;
  const repos = createRepositories();
  const stories = await repos.storyRepository.listRecent(RECENT_STORIES_LIMIT);
  const selectedStory = requestedStoryId
    ? (stories.find((story) => story.id === requestedStoryId) ?? stories[0])
    : stories[0];

  const [facts, sourceMetas, history] = selectedStory
    ? await Promise.all([
        repos.factRepository.listByStoryId(selectedStory.id),
        repos.storySourceRepository.sourcesWithMetaByStoryId(selectedStory.id),
        repos.storyCredibilityHistoryRepository.listByStoryId(selectedStory.id),
      ])
    : [[], [], []];

  return (
    <main
      style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px", fontFamily: "sans-serif" }}
    >
      <h1>Hitelesség és forrás review</h1>
      <p style={{ color: "#555" }}>
        Belső admin felület a Story forrásainak, állításainak és hitelességi pontszámának
        szerkesztéséhez (2026-07-28-i sprint, prioritás #3). Egy forrás vagy állítás kizárása
        automatikusan újraszámolja a hitelességi pontot a maradék adatokból.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 24, marginTop: 24 }}>
        <nav>
          <h2 style={{ fontSize: "1em" }}>Legutóbbi Story-k ({stories.length})</h2>
          <ul style={{ listStyle: "none", padding: 0, fontSize: "0.85em" }}>
            {stories.map((story) => (
              <li key={story.id} style={{ marginBottom: 6 }}>
                <a
                  href={`${PATH}?storyId=${story.id}`}
                  style={{
                    fontWeight: story.id === selectedStory?.id ? 700 : 400,
                    textDecoration: "none",
                    color: "#0645ad",
                  }}
                >
                  {story.canonicalTitle}
                </a>
                {story.credibilityScore !== null ? (
                  <span style={{ color: "#999" }}> ({story.credibilityScore})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </nav>

        <section>
          {selectedStory ? (
            <>
              <h2 style={{ marginTop: 0 }}>{selectedStory.canonicalTitle}</h2>
              <CredibilitySummary story={selectedStory} />

              <form action={recomputeCredibilityAction} style={{ marginBottom: 16 }}>
                <input type="hidden" name="storyId" value={selectedStory.id} />
                <button type="submit">🔄 Újraszámolás a jelenlegi adatokból</button>
              </form>

              <details style={{ marginBottom: 20 }}>
                <summary style={{ cursor: "pointer", color: "#0645ad" }}>
                  Közvetlen felülbírálás (admin manuálisan állítja be a pontot)
                </summary>
                <form
                  action={overrideCredibilityAction}
                  style={{ display: "grid", gap: 8, marginTop: 8, maxWidth: 500 }}
                >
                  <input type="hidden" name="storyId" value={selectedStory.id} />
                  <label style={{ fontSize: "0.85em" }}>
                    Pontszám (0-100):
                    <input
                      type="number"
                      name="score"
                      min={0}
                      max={100}
                      defaultValue={selectedStory.credibilityScore ?? 0}
                      style={{ width: "100%", padding: 4 }}
                    />
                  </label>
                  <label style={{ fontSize: "0.85em" }}>
                    Szöveges minősítés:
                    <input
                      type="text"
                      name="labelHu"
                      defaultValue={selectedStory.credibilityLabelHu ?? ""}
                      style={{ width: "100%", padding: 4 }}
                    />
                  </label>
                  <label style={{ fontSize: "0.85em" }}>
                    Indoklás:
                    <textarea
                      name="justificationHu"
                      defaultValue={selectedStory.credibilityJustificationHu ?? ""}
                      rows={2}
                      style={{ width: "100%", padding: 4 }}
                    />
                  </label>
                  <button type="submit" style={{ justifySelf: "start" }}>
                    Felülbírálás mentése
                  </button>
                </form>
              </details>

              <h3>Források ({sourceMetas.length})</h3>
              <ul style={{ padding: 0, listStyle: "none" }}>
                {sourceMetas.map((source) => (
                  <SourceRow key={source.rawArticleId} storyId={selectedStory.id} source={source} />
                ))}
              </ul>

              <h3>Állítások ({facts.length})</h3>
              <ul style={{ padding: 0, listStyle: "none" }}>
                {facts.map((fact) => (
                  <FactRow key={fact.id} storyId={selectedStory.id} fact={fact} />
                ))}
              </ul>

              <CredibilityHistoryList history={history} />
            </>
          ) : (
            <p>Nincs még egyetlen Story sem.</p>
          )}
        </section>
      </div>
    </main>
  );
}
