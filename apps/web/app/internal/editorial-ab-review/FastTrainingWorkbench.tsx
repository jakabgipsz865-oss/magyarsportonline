"use client";

import type { EditorialCorrectionRow } from "@magyarsportonline/db";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { saveTeachableCorrection } from "../../../lib/editorial-training-actions";
import type { TrainingItem, TrainingSuggestion } from "./types";

interface FastTrainingWorkbenchProps {
  items: TrainingItem[];
  initialCorrections: EditorialCorrectionRow[];
  categoryLabels: Record<string, string>;
  categories: string[];
}

interface Draft {
  correctedSentenceHu: string;
  category: string;
  termEn: string;
  originalSentenceEn: string;
  note: string;
}

const FIELD_LABELS_HU: Record<TrainingItem["field"], string> = {
  title: "cím",
  lead: "lead",
  body: "törzs",
};

const EMPTY_DRAFT: Draft = {
  correctedSentenceHu: "",
  category: "terminology",
  termEn: "",
  originalSentenceEn: "",
  note: "",
};

function defaultDraftFor(item: TrainingItem | undefined): Draft {
  if (!item) {
    return EMPTY_DRAFT;
  }
  const bestSuggestion = item.suggestions[0];
  if (bestSuggestion?.kind === "lexicon") {
    return {
      correctedSentenceHu: bestSuggestion.suggestedSentenceHu,
      category: "terminology",
      termEn: bestSuggestion.termEn,
      originalSentenceEn: bestSuggestion.exampleEn,
      note: "",
    };
  }
  if (bestSuggestion?.kind === "similar") {
    return {
      correctedSentenceHu: bestSuggestion.correctedSentenceHu,
      category: bestSuggestion.category,
      termEn: bestSuggestion.termEn ?? "",
      originalSentenceEn: bestSuggestion.originalSentenceEn,
      note: "",
    };
  }
  return {
    correctedSentenceHu: item.sentenceHu,
    category: "terminology",
    termEn: "",
    originalSentenceEn: "",
    note: "",
  };
}

function matchesSearch(correction: EditorialCorrectionRow, query: string): boolean {
  const haystack = [
    correction.currentSentenceHu,
    correction.correctedSentenceHu,
    correction.termEn ?? "",
    correction.originalSentenceEn,
    correction.note ?? "",
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

const buttonStyle: React.CSSProperties = {
  fontSize: "0.82em",
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #ccc",
  background: "#fff",
  cursor: "pointer",
};

const primaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: "#1e7e34",
  color: "#fff",
  border: "1px solid #1e7e34",
  fontWeight: 600,
};

const textAreaStyle: React.CSSProperties = {
  width: "100%",
  fontSize: "0.95em",
  padding: "8px 10px",
  borderRadius: 6,
  border: "1px solid #ccc",
  boxSizing: "border-box",
};

const inputStyle: React.CSSProperties = { ...textAreaStyle, fontSize: "0.85em" };

export function FastTrainingWorkbench({
  items,
  initialCorrections,
  categoryLabels,
  categories,
}: FastTrainingWorkbenchProps): ReactNode {
  const [doneItemIds, setDoneItemIds] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<Draft>(() => defaultDraftFor(items[0]));
  const [sessionCorrections, setSessionCorrections] = useState<EditorialCorrectionRow[]>([]);
  const [savedCount, setSavedCount] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const textAreaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const queue = useMemo(
    () => items.filter((item) => !doneItemIds.has(item.itemId)),
    [items, doneItemIds],
  );
  const currentIndex = queue.length === 0 ? 0 : Math.min(index, queue.length - 1);
  const currentItem: TrainingItem | undefined = queue[currentIndex];

  const allCorrections = useMemo(
    () => [...sessionCorrections, ...initialCorrections],
    [sessionCorrections, initialCorrections],
  );

  const searchResults = useMemo(() => {
    if (searchQuery.trim().length < 2) {
      return [];
    }
    return allCorrections
      .filter((correction) => matchesSearch(correction, searchQuery))
      .slice(0, 8);
  }, [allCorrections, searchQuery]);

  // Új mondatra lépéskor a draft mindig a legjobb előre kiszámolt javaslatból
  // (vagy magából a mondatból) épül fel újra. A statusMessage-t itt
  // SZÁNDÉKOSAN nem töröljük — sikeres mentés után a sor automatikusan
  // kikerül a queue-ból, ami ugyanígy "currentItem" változást vált ki, és a
  // "✅ Mentve" visszajelzésnek látszania kell, mielőtt eltűnne (lásd
  // goNext/goPrev, ahol a szerkesztő SZÁNDÉKOS navigációja már jogosan törli).
  useEffect(() => {
    if (currentItem) {
      setDraft(defaultDraftFor(currentItem));
    }
  }, [currentItem]);

  const goNext = useCallback(() => {
    setIndex((previous) => (queue.length === 0 ? 0 : (previous + 1) % queue.length));
    setStatusMessage(null);
  }, [queue.length]);

  const goPrev = useCallback(() => {
    setIndex((previous) => (queue.length === 0 ? 0 : (previous - 1 + queue.length) % queue.length));
    setStatusMessage(null);
  }, [queue.length]);

  const applySuggestion = useCallback((suggestion: TrainingSuggestion) => {
    if (suggestion.kind === "lexicon") {
      setDraft({
        correctedSentenceHu: suggestion.suggestedSentenceHu,
        category: "terminology",
        termEn: suggestion.termEn,
        originalSentenceEn: suggestion.exampleEn,
        note: "",
      });
    } else {
      setDraft({
        correctedSentenceHu: suggestion.correctedSentenceHu,
        category: suggestion.category,
        termEn: suggestion.termEn ?? "",
        originalSentenceEn: suggestion.originalSentenceEn,
        note: "",
      });
    }
    textAreaRef.current?.focus();
  }, []);

  const applyFromCorrection = useCallback((correction: EditorialCorrectionRow) => {
    setDraft({
      correctedSentenceHu: correction.correctedSentenceHu,
      category: correction.category,
      termEn: correction.termEn ?? "",
      originalSentenceEn: correction.originalSentenceEn,
      note: "",
    });
    textAreaRef.current?.focus();
  }, []);

  const handleSave = useCallback(() => {
    if (!currentItem || isPending) {
      return;
    }
    if (
      draft.originalSentenceEn.trim().length === 0 ||
      draft.correctedSentenceHu.trim().length === 0
    ) {
      setStatusMessage("Hiányzik az eredeti angol mondat vagy a javított szöveg.");
      return;
    }
    const item = currentItem;
    startTransition(async () => {
      const result = await saveTeachableCorrection({
        storyId: item.storyId,
        category: draft.category,
        termEn: draft.termEn,
        originalSentenceEn: draft.originalSentenceEn,
        currentSentenceHu: item.sentenceHu,
        correctedSentenceHu: draft.correctedSentenceHu,
        note: draft.note,
      });
      if (result.ok) {
        setSessionCorrections((previous) => [result.correction, ...previous]);
        setSavedCount((previous) => previous + 1);
        setDoneItemIds((previous) => new Set(previous).add(item.itemId));
        setStatusMessage(`✅ Mentve (#${savedCount + 1} ma).`);
      } else {
        setStatusMessage(`Hiba: ${result.error}`);
      }
    });
  }, [currentItem, draft, isPending, savedCount]);

  const handleSkip = useCallback(() => {
    goNext();
  }, [goNext]);

  const setCategoryByIndex = useCallback(
    (categoryIndex: number) => {
      const category = categories[categoryIndex];
      if (category) {
        setDraft((previous) => ({ ...previous, category }));
      }
    },
    [categories],
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const target = event.target as HTMLElement | null;
      const isTyping = target?.tagName === "TEXTAREA" || target?.tagName === "INPUT";

      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handleSave();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowRight") {
        event.preventDefault();
        handleSkip();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
        return;
      }
      if (event.altKey && /^[1-6]$/.test(event.key)) {
        event.preventDefault();
        setCategoryByIndex(Number(event.key) - 1);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        if (currentItem) {
          setDraft(defaultDraftFor(currentItem));
        }
        return;
      }

      if (isTyping) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }
      if (event.key === "n" || event.key === "ArrowRight") {
        event.preventDefault();
        handleSkip();
        return;
      }
      if (event.key === "p" || event.key === "ArrowLeft") {
        event.preventDefault();
        goPrev();
        return;
      }
      if (/^[1-6]$/.test(event.key)) {
        event.preventDefault();
        setCategoryByIndex(Number(event.key) - 1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave, handleSkip, goPrev, currentItem, setCategoryByIndex]);

  return (
    <section
      style={{
        border: "2px solid #1e7e34",
        borderRadius: 10,
        padding: 16,
        marginBottom: 24,
        background: "#fbfffc",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h2 style={{ margin: 0 }}>⚡ Gyors tanítási mód</h2>
        <div data-testid="progress" style={{ fontSize: "0.85em", color: "#555" }}>
          Hátravan: <strong>{queue.length}</strong> mondat · Ma elmentve:{" "}
          <strong>{savedCount}</strong>
        </div>
      </div>

      <p style={{ fontSize: "0.78em", color: "#777", margin: "6px 0 14px" }}>
        Billentyűk: <kbd>Ctrl/⌘+Enter</kbd> mentés és következő · <kbd>n</kbd> / <kbd>→</kbd>{" "}
        kihagyás · <kbd>p</kbd> / <kbd>←</kbd> előző · <kbd>Alt+1..6</kbd> kategória · <kbd>/</kbd>{" "}
        keresés · <kbd>Esc</kbd> alapállapot
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div>
          {!currentItem ? (
            <p style={{ color: "#1e7e34", fontWeight: 600 }}>
              🎉 Nincs több tanítható mondat — minden elérhető sor át van nézve.
            </p>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  fontSize: "0.75em",
                  color: "#999",
                  marginBottom: 6,
                }}
              >
                <span style={{ textTransform: "uppercase", fontWeight: 600 }}>
                  {FIELD_LABELS_HU[currentItem.field]}
                </span>
                <code>{currentItem.storyId}</code>
                {currentItem.changed && (
                  <span style={{ background: "#fff3a3", padding: "0 6px", borderRadius: 4 }}>
                    változott A→B
                  </span>
                )}
              </div>

              <p
                data-testid="current-sentence"
                style={{
                  fontSize: "1.05em",
                  background: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: 10,
                }}
              >
                {currentItem.sentenceHu}
              </p>

              {currentItem.originalSourcesText && (
                <details style={{ marginBottom: 10 }}>
                  <summary style={{ cursor: "pointer", fontSize: "0.8em", color: "#0645ad" }}>
                    Eredeti angol forrás (referencia)
                  </summary>
                  <p style={{ fontSize: "0.85em", whiteSpace: "pre-wrap", color: "#555" }}>
                    {currentItem.originalSourcesText}
                  </p>
                </details>
              )}

              {currentItem.suggestions.map((suggestion, suggestionIndex) => (
                <div
                  key={suggestionIndex}
                  style={{
                    background: suggestion.kind === "lexicon" ? "#e6f4ea" : "#f0f6ff",
                    borderRadius: 6,
                    padding: 8,
                    marginBottom: 6,
                    fontSize: "0.82em",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  <span>
                    {suggestion.kind === "lexicon" ? (
                      <>
                        💡 Ismert kifejezés: &quot;{suggestion.matchedAvoidHu}&quot; →{" "}
                        <strong>{suggestion.naturalHu}</strong>
                      </>
                    ) : (
                      <>
                        🔁 Hasonló korábbi javítás ({Math.round(suggestion.score * 100)}% egyezés) [
                        {categoryLabels[suggestion.category] ?? suggestion.category}]: &quot;
                        {suggestion.currentSentenceHu}&quot; →{" "}
                        <strong>{suggestion.correctedSentenceHu}</strong>
                      </>
                    )}
                  </span>
                  <button
                    type="button"
                    data-testid={`apply-suggestion-${suggestion.kind}`}
                    style={buttonStyle}
                    onClick={() => applySuggestion(suggestion)}
                  >
                    Alkalmaz
                  </button>
                </div>
              ))}

              <label style={{ fontSize: "0.78em", color: "#666", display: "block", marginTop: 10 }}>
                Eredeti angol mondat:
                <textarea
                  data-testid="original-en-input"
                  rows={2}
                  style={textAreaStyle}
                  value={draft.originalSentenceEn}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      originalSentenceEn: event.target.value,
                    }))
                  }
                />
              </label>

              <label style={{ fontSize: "0.78em", color: "#666", display: "block", marginTop: 8 }}>
                Javított magyar megfogalmazás:
                <textarea
                  ref={textAreaRef}
                  data-testid="corrected-hu-input"
                  rows={3}
                  style={textAreaStyle}
                  value={draft.correctedSentenceHu}
                  onChange={(event) =>
                    setDraft((previous) => ({
                      ...previous,
                      correctedSentenceHu: event.target.value,
                    }))
                  }
                />
              </label>

              <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                {categories.map((category, categoryIndex) => (
                  <button
                    key={category}
                    type="button"
                    data-testid={`category-button-${category}`}
                    data-selected={draft.category === category}
                    onClick={() => setCategoryByIndex(categoryIndex)}
                    style={{
                      ...buttonStyle,
                      background: draft.category === category ? "#1e7e34" : "#fff",
                      color: draft.category === category ? "#fff" : "#333",
                    }}
                  >
                    {categoryIndex + 1}. {categoryLabels[category] ?? category}
                  </button>
                ))}
              </div>

              <div style={{ display: "flex", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                <label style={{ fontSize: "0.78em", color: "#666", flex: "1 1 200px" }}>
                  Angol kifejezés (opcionális):
                  <input
                    type="text"
                    style={inputStyle}
                    value={draft.termEn}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, termEn: event.target.value }))
                    }
                  />
                </label>
                <label style={{ fontSize: "0.78em", color: "#666", flex: "1 1 200px" }}>
                  Megjegyzés (opcionális):
                  <input
                    type="text"
                    style={inputStyle}
                    value={draft.note}
                    onChange={(event) =>
                      setDraft((previous) => ({ ...previous, note: event.target.value }))
                    }
                  />
                </label>
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
                <button
                  type="button"
                  data-testid="save-button"
                  style={primaryButtonStyle}
                  onClick={handleSave}
                  disabled={isPending}
                >
                  ✅ Mentés és következő (Ctrl+Enter)
                </button>
                <button
                  type="button"
                  data-testid="skip-button"
                  style={buttonStyle}
                  onClick={handleSkip}
                >
                  ⏭ Kihagyás (n / →)
                </button>
                <button
                  type="button"
                  data-testid="prev-button"
                  style={buttonStyle}
                  onClick={goPrev}
                >
                  ⬅ Előző (p / ←)
                </button>
                {statusMessage && (
                  <span data-testid="status-message" style={{ fontSize: "0.82em", color: "#555" }}>
                    {statusMessage}
                  </span>
                )}
              </div>
            </>
          )}
        </div>

        <div>
          <label style={{ fontSize: "0.8em", color: "#666" }}>
            🔎 Keresés korábbi javítások között (/):
            <input
              ref={searchInputRef}
              type="text"
              data-testid="search-input"
              placeholder="pl. gólos dráma"
              style={inputStyle}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </label>
          <ul style={{ fontSize: "0.78em", margin: "8px 0", padding: 0, listStyle: "none" }}>
            {searchResults.map((correction) => (
              <li
                key={correction.id}
                style={{
                  marginBottom: 6,
                  padding: 6,
                  background: "#fff",
                  border: "1px solid #eee",
                  borderRadius: 6,
                }}
              >
                <div style={{ color: "#999" }}>[{categoryLabels[correction.category]}]</div>
                <div>
                  &quot;{correction.currentSentenceHu}&quot; →{" "}
                  <strong>{correction.correctedSentenceHu}</strong>
                </div>
                <button
                  type="button"
                  data-testid="apply-search-result"
                  style={{ ...buttonStyle, marginTop: 4, fontSize: "0.85em", padding: "2px 8px" }}
                  onClick={() => applyFromCorrection(correction)}
                >
                  Alkalmaz
                </button>
              </li>
            ))}
            {searchQuery.trim().length >= 2 && searchResults.length === 0 && (
              <li style={{ color: "#999" }}>Nincs találat.</li>
            )}
          </ul>
        </div>
      </div>
    </section>
  );
}
