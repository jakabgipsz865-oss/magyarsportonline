import { createLogger, type Logger } from "@magyarsportonline/observability";
import { env } from "./env";

let cachedLogger: Logger | undefined;

export function getLogger(): Logger {
  cachedLogger ??= createLogger({ level: env.LOG_LEVEL });
  return cachedLogger;
}
