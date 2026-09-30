import { getCloudflareContext } from "@opennextjs/cloudflare/cloudflare-context";
import { env } from "./env";
export function runtimeEnvironment(): "production" | "preview" | "development" {
  try {
    const cf = getCloudflareContext().env.APP_ENV;
    if (cf) return cf;
  } catch {
    /* Local build/test has no Worker context. */
  }
  return env.APP_ENV;
}
