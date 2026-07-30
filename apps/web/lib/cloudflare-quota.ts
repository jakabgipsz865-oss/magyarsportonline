const QUOTA_RESET_GRACE_MS = 5 * 60_000;

/** Cloudflare's documented daily free allocation resets at 00:00 UTC. */
export function delayUntilNextCloudflareQuotaReset(now: Date): number {
  const nextReset = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0,
  );
  return nextReset - now.getTime() + QUOTA_RESET_GRACE_MS;
}
