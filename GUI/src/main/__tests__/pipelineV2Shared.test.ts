import { describe, expect, it } from "vitest";

import {
  normalizeProfileCompatibility,
  parseBooleanFlag,
} from "../pipelineV2Shared";

describe("pipelineV2Shared compatibility normalization", () => {
  it("normalizes api serial_requests to strict_concurrency", () => {
    const payload: Record<string, any> = {
      id: "api_legacy",
      serial_requests: "true",
    };

    const changed = normalizeProfileCompatibility("api", payload);

    expect(changed).toBe(true);
    expect(payload.strict_concurrency).toBe(true);
    expect(payload).not.toHaveProperty("serial_requests");
  });

  it("normalizes api strictConcurrency camelCase to snake_case", () => {
    const payload: Record<string, any> = {
      id: "api_camel",
      strictConcurrency: 1,
    };

    const changed = normalizeProfileCompatibility("api", payload);

    expect(changed).toBe(true);
    expect(payload.strict_concurrency).toBe(true);
    expect(payload).not.toHaveProperty("strictConcurrency");
  });

  it("normalizes chunk type alias", () => {
    const payload: Record<string, any> = {
      id: "chunk_legacy",
      type: "legacy",
    };

    const changed = normalizeProfileCompatibility("chunk", payload);

    expect(changed).toBe(true);
    expect(payload.chunk_type).toBe("block");
    expect(payload).not.toHaveProperty("type");
  });

  it("parseBooleanFlag handles common legacy values", () => {
    expect(parseBooleanFlag("true")).toBe(true);
    expect(parseBooleanFlag("1")).toBe(true);
    expect(parseBooleanFlag("false")).toBe(false);
    expect(parseBooleanFlag("0")).toBe(false);
  });
});
