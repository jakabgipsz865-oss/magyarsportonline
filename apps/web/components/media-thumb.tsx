import type { CSSProperties, ReactNode } from "react";

/**
 * Deterministic pitch/amber-family gradient, picked from the story id so
 * the same Story always renders the same placeholder tone across requests
 * (no client-side randomness, no layout flicker).
 */
const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(135deg, #0a4f36, #0e6b48 60%, #1c8a5f)",
  "linear-gradient(135deg, #0a4f36, #256b48 55%, #3f8f63)",
  "linear-gradient(135deg, #5c3a12, #8a5a1f 55%, #b8721a)",
  "linear-gradient(135deg, #0a4f36, #14533d 45%, #b8721a)",
];

function hashToIndex(seed: string, mod: number): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % mod;
}

/** First 1-2 letters of each significant word — "Manchester United" -> "MU", "Liverpool" -> "L". */
function monogramOf(title: string): string {
  const words = title
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .filter((word) => !/^(a|az|és|de|egy|the|a's)$/i.test(word));
  const letters = words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  return letters || title.slice(0, 2).toUpperCase();
}

interface MediaThumbProps {
  imageUrl: string | null;
  title: string;
  seed: string;
  className?: string;
  alt?: string;
}

export function MediaThumb({ imageUrl, title, seed, className, alt }: MediaThumbProps): ReactNode {
  if (imageUrl) {
    return (
      <div className={className ? `media ${className}` : "media"}>
        {/* Plain <img>, not next/image: source images come from arbitrary RSS/CDN domains, not worth a remotePatterns allowlist for an MVP. */}
        <img src={imageUrl} alt={alt ?? title} loading="lazy" />
      </div>
    );
  }

  const gradient = PLACEHOLDER_GRADIENTS[hashToIndex(seed, PLACEHOLDER_GRADIENTS.length)];
  const style: CSSProperties = { background: gradient };
  return (
    <div className={className ? `media ${className}` : "media"} style={style}>
      <div className="media-placeholder">{monogramOf(title)}</div>
    </div>
  );
}
