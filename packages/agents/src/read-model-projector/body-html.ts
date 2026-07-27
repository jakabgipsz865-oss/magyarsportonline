function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Converts the plain-text `StoryVersion.body_hu` (LLM-generated) into
 * paragraph-wrapped HTML for `story_read_model.body_html`. Escapes HTML
 * special characters — the body text originates from an LLM completion, so
 * it is untrusted for direct HTML embedding even though it isn't user input
 * in the traditional sense.
 */
export function toBodyHtml(bodyHu: string): string {
  return bodyHu
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n");
}
