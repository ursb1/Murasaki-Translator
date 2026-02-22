import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { describe, expect, it } from "vitest";
import { __testOnly, createApiStatsService } from "../apiStatsStore";

const mustNormalize = (input: Record<string, unknown>) => {
  const normalized = __testOnly.normalizeEvent(input);
  if (!normalized) {
    throw new Error("failed to normalize event");
  }
  return normalized;
};

describe("apiStatsStore normalizeEvent", () => {
  it("normalizes fields and sanitizes sensitive headers", () => {
    const event = mustNormalize({
      apiProfileId: "bad profile id",
      requestId: "req_1",
      phase: "request_end",
      source: "unknown_source",
      origin: "unit_test",
      method: "post",
      url: "https://example.com/v1/chat/completions",
      statusCode: 200,
      durationMs: 123,
      inputTokens: 7,
      outputTokens: 9,
      requestHeaders: {
        Authorization: "Bearer secret",
        "X-Trace-Id": "trace_1",
      },
      responseHeaders: {
        "api-key": "abc",
        "content-type": "application/json",
      },
    });

    expect(event.apiProfileId).toMatch(/^adhoc_[0-9a-f]{12}$/);
    expect(event.source).toBe("unknown");
    expect(event.method).toBe("POST");
    expect(event.path).toBe("/v1/chat/completions");
    expect(event.requestHeaders?.Authorization).toBe("[REDACTED]");
    expect(event.requestHeaders?.["X-Trace-Id"]).toBe("trace_1");
    expect(event.responseHeaders?.["api-key"]).toBe("[REDACTED]");
    expect(event.responseHeaders?.["content-type"]).toBe("application/json");
  });
});

describe("apiStatsStore aggregation", () => {
  it("builds request records and computes overview/trend/breakdown", () => {
    const events = [
      mustNormalize({
        apiProfileId: "api_demo",
        requestId: "r1",
        phase: "request_start",
        ts: "2026-02-22T00:00:00.000Z",
        source: "api_test",
        origin: "unit_test",
        model: "model-a",
        inputTokens: 10,
        outputTokens: 0,
      }),
      mustNormalize({
        apiProfileId: "api_demo",
        requestId: "r1",
        phase: "request_retry",
        ts: "2026-02-22T00:00:01.000Z",
        source: "api_test",
        origin: "unit_test",
        errorType: "timeout",
        retryAttempt: 1,
      }),
      mustNormalize({
        apiProfileId: "api_demo",
        requestId: "r1",
        phase: "request_end",
        ts: "2026-02-22T00:00:03.000Z",
        source: "api_test",
        origin: "unit_test",
        statusCode: 200,
        durationMs: 300,
        inputTokens: 10,
        outputTokens: 20,
      }),
      mustNormalize({
        apiProfileId: "api_demo",
        requestId: "r2",
        phase: "request_start",
        ts: "2026-02-22T00:10:00.000Z",
        source: "translation_run",
        origin: "unit_test",
        model: "model-b",
        inputTokens: 7,
        outputTokens: 1,
      }),
      mustNormalize({
        apiProfileId: "api_demo",
        requestId: "r2",
        phase: "request_error",
        ts: "2026-02-22T00:10:02.000Z",
        source: "translation_run",
        origin: "unit_test",
        statusCode: 429,
        durationMs: 500,
        errorType: "rate_limited",
      }),
      mustNormalize({
        apiProfileId: "api_demo",
        requestId: "r3",
        phase: "request_start",
        ts: "2026-02-22T00:20:00.000Z",
        source: "api_models",
        origin: "unit_test",
        model: "model-a",
      }),
    ];

    const requests = __testOnly.aggregateRequests(events);
    expect(requests).toHaveLength(3);
    expect(requests.map((item) => item.requestId)).toEqual(["r3", "r2", "r1"]);
    expect(requests.find((item) => item.requestId === "r1")?.retryCount).toBe(1);
    expect(requests.find((item) => item.requestId === "r2")?.phaseFinal).toBe(
      "request_error",
    );

    const overview = __testOnly.computeOverview(requests, events);
    expect(overview.totalEvents).toBe(6);
    expect(overview.totalRequests).toBe(3);
    expect(overview.successRequests).toBe(1);
    expect(overview.failedRequests).toBe(1);
    expect(overview.inflightRequests).toBe(1);
    expect(overview.successRate).toBe(33.33);
    expect(overview.totalRetries).toBe(1);
    expect(overview.totalInputTokens).toBe(17);
    expect(overview.totalOutputTokens).toBe(21);
    expect(overview.avgLatencyMs).toBe(400);
    expect(overview.p50LatencyMs).toBe(300);
    expect(overview.p95LatencyMs).toBe(500);
    expect(overview.requestsPerMinuteAvg).toBe(0.15);
    expect(overview.peakRequestsPerMinute).toBe(1);
    expect(overview.statusCodeCounts).toMatchObject({
      "200": 1,
      "429": 1,
      unknown: 1,
    });
    expect(overview.sourceCounts).toMatchObject({
      api_models: 1,
      translation_run: 1,
      api_test: 1,
    });
    expect(overview.errorTypeCounts).toMatchObject({
      rate_limited: 1,
    });
    const localHour = new Date("2026-02-22T00:00:00.000Z").getHours();
    expect(overview.byHour[localHour]?.count).toBe(3);
    expect(overview.latestRequestAt).toBe("2026-02-22T00:20:00.000Z");

    const trendRequests = __testOnly.computeTrend(requests, "requests", "hour");
    expect(trendRequests).toHaveLength(1);
    expect(trendRequests[0]).toMatchObject({
      value: 3,
      requests: 3,
      errors: 1,
      inputTokens: 17,
      outputTokens: 21,
    });

    const trendLatency = __testOnly.computeTrend(requests, "latency", "hour");
    expect(trendLatency[0]?.value).toBe(400);

    const breakdownStatus = __testOnly.computeBreakdown(requests, "status_code");
    const statusMap = Object.fromEntries(
      breakdownStatus.map((item) => [item.key, item.count]),
    );
    expect(statusMap).toMatchObject({
      "200": 1,
      "429": 1,
      unknown: 1,
    });

    const breakdownError = __testOnly.computeBreakdown(requests, "error_type");
    const errorMap = Object.fromEntries(
      breakdownError.map((item) => [item.key, item.count]),
    );
    expect(errorMap).toMatchObject({
      rate_limited: 1,
      none: 2,
    });
  });
});

describe("apiStatsStore persistence", () => {
  it("writes events into dedicated profile-bound jsonl file", async () => {
    const root = mkdtempSync(join(tmpdir(), "api-stats-store-"));
    try {
      const service = createApiStatsService({
        getProfilesDir: () => root,
      });
      await service.appendEvent({
        apiProfileId: "profile.alpha",
        requestId: "persist_1",
        phase: "request_start",
        ts: "2026-02-22T01:00:00.000Z",
        source: "api_test",
        origin: "unit_test",
      });

      await service.appendEvent({
        apiProfileId: "profile.alpha",
        requestId: "persist_2",
        phase: "invalid_phase",
        ts: "2026-02-22T01:01:00.000Z",
        source: "api_test",
        origin: "unit_test",
      });

      const filePath = join(root, "api", "profile.alpha.stats.events.jsonl");
      const lines = readFileSync(filePath, "utf-8")
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      expect(lines).toHaveLength(1);
      const stored = JSON.parse(lines[0] || "{}");
      expect(stored.requestId).toBe("persist_1");
      expect(stored.phase).toBe("request_start");
      expect(stored.apiProfileId).toBe("profile.alpha");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
