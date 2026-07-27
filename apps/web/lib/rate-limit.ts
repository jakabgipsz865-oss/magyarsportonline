/**
 * Egyszerű, folyamaton belüli fixed-window rate limiter a publikus API-hoz
 * (API abuse elleni alapvédelem, docs/architecture/04-api-spec.md §4.1).
 *
 * Tudatos korlát: Vercel serverless környezetben példányonkénti a számláló,
 * tehát a tényleges globális limit a párhuzamos példányok számával
 * szorzódik — alapvédelemnek (egyetlen kliens elárasztása ellen) elég,
 * elosztott limiter (Upstash Ratelimit) a roadmap Fázis 13 tétele.
 */
interface WindowState {
  windowStartMs: number;
  count: number;
}

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  now?: () => number;
}

export class FixedWindowRateLimiter {
  private readonly buckets = new Map<string, WindowState>();

  constructor(private readonly options: RateLimiterOptions) {}

  /** true = a kérés beengedhető; false = limit fölött. */
  allow(key: string): boolean {
    const now = this.options.now?.() ?? Date.now();
    const bucket = this.buckets.get(key);

    if (!bucket || now - bucket.windowStartMs >= this.options.windowMs) {
      // Új ablak — közben a rég nem látott kulcsokat is kidobjuk, hogy a
      // Map ne nőjön korlátlanul hosszú életű példányokon.
      if (this.buckets.size > 10_000) {
        this.buckets.clear();
      }
      this.buckets.set(key, { windowStartMs: now, count: 1 });
      return true;
    }

    bucket.count += 1;
    return bucket.count <= this.options.maxRequests;
  }
}

const globalLimiter = new FixedWindowRateLimiter({ windowMs: 60_000, maxRequests: 120 });

/** Kliens-IP a Vercel/proxy fejlécekből — hiányukban közös "unknown" vödör. */
export function clientKeyFromHeaders(headers: Headers): string {
  const forwardedFor = headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }
  return headers.get("x-real-ip") ?? "unknown";
}

export function allowPublicApiRequest(headers: Headers): boolean {
  return globalLimiter.allow(clientKeyFromHeaders(headers));
}
