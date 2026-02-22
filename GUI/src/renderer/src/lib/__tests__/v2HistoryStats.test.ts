import { describe, it, expect } from "vitest";
import {
  applyFinalPayloadToV2HistoryStats,
  applyProgressPayloadToV2HistoryStats,
  applyRetryEventToV2HistoryStats,
  createEmptyV2HistoryStats,
} from "../v2HistoryStats";

describe("v2HistoryStats helpers", () => {
  it("creates an empty stats snapshot", () => {
    expect(createEmptyV2HistoryStats()).toEqual({
      totalRequests: 0,
      totalRetries: 0,
      totalErrors: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
  });

  it("applies progress payload request/token counters", () => {
    const next = applyProgressPayloadToV2HistoryStats(
      createEmptyV2HistoryStats(),
      {
        total_requests: 12,
        total_input_tokens: 3456,
        total_output_tokens: 789,
      },
    );
    expect(next.totalRequests).toBe(12);
    expect(next.totalInputTokens).toBe(3456);
    expect(next.totalOutputTokens).toBe(789);
  });

  it("ignores invalid progress payload values", () => {
    const base = {
      totalRequests: 5,
      totalRetries: 1,
      totalErrors: 0,
      totalInputTokens: 100,
      totalOutputTokens: 50,
    };
    const next = applyProgressPayloadToV2HistoryStats(base, {
      total_requests: "bad",
      total_input_tokens: -99,
      total_output_tokens: null,
    } as Record<string, unknown>);
    expect(next.totalRequests).toBe(5);
    expect(next.totalInputTokens).toBe(100);
    expect(next.totalOutputTokens).toBe(50);
  });

  it("increments retry count on retry event", () => {
    const next = applyRetryEventToV2HistoryStats({
      totalRequests: 2,
      totalRetries: 3,
      totalErrors: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
    });
    expect(next.totalRetries).toBe(4);
  });

  it("applies final payload and normalizes error status codes", () => {
    const next = applyFinalPayloadToV2HistoryStats(
      createEmptyV2HistoryStats(),
      {
        totalRequests: 88,
        totalRetries: 9,
        totalErrors: 2,
        totalInputTokens: 12345,
        totalOutputTokens: 6789,
        errorStatusCodes: {
          "429": 3,
          "500": "x",
          "502": -1,
        },
      },
    );
    expect(next).toEqual({
      totalRequests: 88,
      totalRetries: 9,
      totalErrors: 2,
      totalInputTokens: 12345,
      totalOutputTokens: 6789,
      errorStatusCodes: {
        "429": 3,
      },
    });
  });
});
