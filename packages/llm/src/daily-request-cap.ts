import type {
  JsonCompletionRequest,
  JsonCompletionResult,
  LlmClient,
  TextCompletionRequest,
  TextCompletionResult,
} from "./client";

export class DailyLlmRequestCapError extends Error {
  constructor(
    public readonly provider: string,
    public readonly cap: number,
  ) {
    super(`${provider} daily request cap (${cap}) reached`);
    this.name = "DailyLlmRequestCapError";
  }
}

export interface DailyRequestUsageReader {
  reserveRequest(provider: string, model: string, since: Date, cap: number): Promise<string | null>;
  finalizeRequest(reservationId: string, inputTokens: number, outputTokens: number): Promise<void>;
  releaseRequest(reservationId: string): Promise<void>;
}

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const pacificFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function partsAt(date: Date): Record<string, number> {
  return Object.fromEntries(
    pacificFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
}

function pacificMidnightUtc(year: number, month: number, day: number): Date {
  const guess = new Date(Date.UTC(year, month - 1, day));
  const local = partsAt(guess);
  const offsetMs =
    Date.UTC(
      local["year"]!,
      local["month"]! - 1,
      local["day"]!,
      local["hour"]!,
      local["minute"]!,
      local["second"]!,
    ) - guess.getTime();
  return new Date(Date.UTC(year, month - 1, day) - offsetMs);
}

export function geminiQuotaDayStart(now = new Date()): Date {
  const local = partsAt(now);
  return pacificMidnightUtc(local["year"]!, local["month"]!, local["day"]!);
}

export function delayUntilNextGeminiQuotaReset(now = new Date()): number {
  const local = partsAt(now);
  const nextDate = new Date(Date.UTC(local["year"]!, local["month"]! - 1, local["day"]! + 1));
  return (
    pacificMidnightUtc(
      nextDate.getUTCFullYear(),
      nextDate.getUTCMonth() + 1,
      nextDate.getUTCDate(),
    ).getTime() -
    now.getTime() +
    5 * 60_000
  );
}

/** Application-side hard stop placed outside the metered provider client. */
export class DailyRequestCappedLlmClient implements LlmClient {
  constructor(
    private readonly inner: LlmClient,
    private readonly provider: string,
    private readonly cap: number,
    private readonly usage: DailyRequestUsageReader,
    private readonly shouldReleaseReservation: (error: unknown) => boolean = () => false,
  ) {}

  get modelLabel(): string | undefined {
    return this.inner.modelLabel;
  }

  async completeText(request: TextCompletionRequest): Promise<TextCompletionResult> {
    const reservationId = await this.reserve();
    try {
      const result = await this.inner.completeText(request);
      await this.finalize(reservationId, result.inputTokens, result.outputTokens);
      return result;
    } catch (error) {
      await this.releaseIfUnmetered(reservationId, error);
      throw error;
    }
  }

  async completeJson(request: JsonCompletionRequest): Promise<JsonCompletionResult> {
    const reservationId = await this.reserve();
    try {
      const result = await this.inner.completeJson(request);
      await this.finalize(reservationId, result.inputTokens, result.outputTokens);
      return result;
    } catch (error) {
      await this.releaseIfUnmetered(reservationId, error);
      throw error;
    }
  }

  private async reserve(): Promise<string> {
    const reservationId = await this.usage.reserveRequest(
      this.provider,
      this.inner.modelLabel ?? "unknown",
      geminiQuotaDayStart(),
      this.cap,
    );
    if (!reservationId) {
      throw new DailyLlmRequestCapError(this.provider, this.cap);
    }
    return reservationId;
  }

  private async finalize(
    reservationId: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<void> {
    try {
      await this.usage.finalizeRequest(reservationId, inputTokens, outputTokens);
    } catch {
      // The reservation already counts toward the hard cap. A metrics update
      // failure must not replay a successful paid/quota-consuming request.
    }
  }

  private async releaseIfUnmetered(reservationId: string, error: unknown): Promise<void> {
    if (!this.shouldReleaseReservation(error)) return;
    try {
      await this.usage.releaseRequest(reservationId);
    } catch {
      // Release failures remain counted, preserving the fail-closed hard cap.
    }
  }
}

export function isDailyLlmQuotaError(error: unknown): boolean {
  return error instanceof DailyLlmRequestCapError;
}
