import type { CSSProperties, ReactNode } from "react";

/**
 * Deterministic pitch/amber-family gradient, picked from the story id so
 * the same Story always renders the same placeholder tone across requests
 * (no client-side randomness, no layout flicker).
 */
const PLACEHOLDER_GRADIENTS = [
  "linear-gradient(135deg, #240507, #7f1018 60%, #d51c28)",
  "linear-gradient(135deg, #080808, #242424 55%, #761018)",
  "linear-gradient(135deg, #19080a, #531017 55%, #9b1921)",
  "linear-gradient(135deg, #050505, #241114 45%, #b81620)",
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
