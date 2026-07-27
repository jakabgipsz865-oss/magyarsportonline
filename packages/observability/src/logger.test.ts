import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createAgentLogger, createLogger } from "./logger";

function createCapturingDestination() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(chunk.toString());
      callback();
    },
  });
  return { stream, lines };
}

function parseLastLine(lines: string[]): Record<string, unknown> {
  const last = lines.at(-1);
  if (!last) {
    throw new Error("no log lines captured");
  }
  return JSON.parse(last) as Record<string, unknown>;
}

describe("createLogger", () => {
  it("writes structured JSON with the given context and message", () => {
    const { stream, lines } = createCapturingDestination();
    const logger = createLogger({ destination: stream });

    logger.info({ agentName: "source-ingest", storyId: "story-1" }, "ingested");

    const entry = parseLastLine(lines);
    expect(entry["msg"]).toBe("ingested");
    expect(entry["agentName"]).toBe("source-ingest");
    expect(entry["storyId"]).toBe("story-1");
  });

  it("respects the configured level (warn suppresses info)", () => {
    const { stream, lines } = createCapturingDestination();
    const logger = createLogger({ destination: stream, level: "warn" });

    logger.info({ agentName: "dedup" }, "should not appear");
    logger.warn({ agentName: "dedup" }, "should appear");

    expect(lines).toHaveLength(1);
    expect(parseLastLine(lines)["msg"]).toBe("should appear");
  });
});

describe("createAgentLogger", () => {
  it("binds agentName onto every subsequent log line", () => {
    const { stream, lines } = createCapturingDestination();
    const base = createLogger({ destination: stream });
    const agentLogger = createAgentLogger(base, "fact-verification");

    agentLogger.info({ storyId: "story-42" }, "facts verified");

    const entry = parseLastLine(lines);
    expect(entry["agentName"]).toBe("fact-verification");
    expect(entry["storyId"]).toBe("story-42");
  });
});
