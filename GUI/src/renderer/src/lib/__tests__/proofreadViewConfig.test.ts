import { describe, expect, it } from "vitest";
import {
  buildProofreadLineLayoutMetrics,
  normalizeProofreadEngineMode,
  parseLegacyActivePipelineId,
  resolveProofreadPipelineId,
  resolveProofreadRetranslateOptions,
} from "../proofreadViewConfig";

describe("normalizeProofreadEngineMode", () => {
  it("returns v2 only when explicit v2 is provided", () => {
    expect(normalizeProofreadEngineMode("v2")).toBe("v2");
    expect(normalizeProofreadEngineMode(" v2 ")).toBe("v2");
    expect(normalizeProofreadEngineMode("v1")).toBe("v1");
    expect(normalizeProofreadEngineMode(undefined)).toBe("v1");
  });
});

describe("parseLegacyActivePipelineId", () => {
  it("parses json string payload", () => {
    expect(parseLegacyActivePipelineId('"pipeline_1"')).toBe("pipeline_1");
  });

  it("returns empty string on invalid payload", () => {
    expect(parseLegacyActivePipelineId("not-json")).toBe("");
    expect(parseLegacyActivePipelineId("")).toBe("");
  });
});

describe("resolveProofreadPipelineId", () => {
  it("prefers primary pipeline id", () => {
    expect(resolveProofreadPipelineId("pipeline_main", '"fallback"')).toBe(
      "pipeline_main",
    );
  });

  it("falls back to legacy payload", () => {
    expect(resolveProofreadPipelineId("", '"fallback"')).toBe("fallback");
  });
});

describe("resolveProofreadRetranslateOptions", () => {
  it("returns v1 options when engine is v1", () => {
    expect(
      resolveProofreadRetranslateOptions({
        engineMode: "v1",
        pipelineId: "pipeline_1",
      }),
    ).toEqual({ useV2: false, pipelineId: "" });
  });

  it("returns v2 options and resolved pipeline id", () => {
    expect(
      resolveProofreadRetranslateOptions({
        engineMode: "v2",
        pipelineId: "",
        legacyPipelineRaw: '"pipeline_fallback"',
      }),
    ).toEqual({ useV2: true, pipelineId: "pipeline_fallback" });
  });
});

describe("buildProofreadLineLayoutMetrics", () => {
  it("returns compact metrics for single-line blocks", () => {
    const metrics = buildProofreadLineLayoutMetrics(1);
    expect(metrics.isSingleLineBlock).toBe(true);
    expect(metrics.rowMinHeight).toBe(28);
    expect(metrics.lineHeight).toBe(24);
  });

  it("returns default metrics for multi-line blocks", () => {
    const metrics = buildProofreadLineLayoutMetrics(3);
    expect(metrics.isSingleLineBlock).toBe(false);
    expect(metrics.rowMinHeight).toBe(20);
    expect(metrics.lineHeight).toBe(20);
  });
});
