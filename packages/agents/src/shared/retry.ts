/**
 * Kis, függőségmentes retry-segéd átmeneti hibákra (RSS-fetch, külső API).
 * Exponenciális backoff, alapértelmezésben 2 újrapróbálkozás (3 kísérlet).
 * Az Anthropic SDK-nak saját beépített retry-ja van — ez a segéd a
 * sima HTTP-forrásokhoz (pl. rss-parser) kell.
 */
export interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  /** Tesztelhetőség: injektálható sleep. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const retries = options.retries ?? 2;
  const baseDelayMs = options.baseDelayMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}
