import { describe, it, expect } from "vitest";
import { buildPipelineSummary } from "../pipelineProfile";

describe("pipelineProfile helpers", () => {
  it("builds summary from snake_case fields", () => {
    const data = {
      id: "pipeline_alpha",
      name: "Pipeline Alpha",
      provider: "api_alpha",
      prompt: "prompt_alpha",
      parser: "parser_alpha",
      line_policy: "line_alpha",
      chunk_policy: "chunk_alpha",
    };
    expect(buildPipelineSummary(data)).toEqual({
      id: "pipeline_alpha",
      name: "Pipeline Alpha",
      provider: "api_alpha",
      prompt: "prompt_alpha",
      parser: "parser_alpha",
      linePolicy: "line_alpha",
      chunkPolicy: "chunk_alpha",
    });
  });

  it("builds summary from camelCase fields", () => {
    const data = {
      id: "pipeline_beta",
      name: "Pipeline Beta",
      provider: "api_beta",
      prompt: "prompt_beta",
      parser: "parser_beta",
      linePolicy: "line_beta",
      chunkPolicy: "chunk_beta",
    };
    const result = buildPipelineSummary(data);
    expect(result.linePolicy).toBe("line_beta");
    expect(result.chunkPolicy).toBe("chunk_beta");
  });

  it("uses fallback values when data is empty", () => {
    const result = buildPipelineSummary(null, {
      id: "fallback_id",
      name: "Fallback Name",
    });
    expect(result.id).toBe("fallback_id");
    expect(result.name).toBe("Fallback Name");
    expect(result.provider).toBe("");
  });
});
