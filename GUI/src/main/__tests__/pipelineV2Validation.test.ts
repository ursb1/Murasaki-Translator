import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  validatePipelineRun,
  validateProfileLocal,
} from "../pipelineV2Validation";

const createProfilesDir = async () => {
  const dir = await mkdtemp(join(tmpdir(), "pipelinev2-"));
  await Promise.all(
    ["api", "prompt", "parser", "policy", "chunk", "pipeline"].map((kind) =>
      mkdir(join(dir, kind), { recursive: true }),
    ),
  );
  return dir;
};

const writeProfile = async (
  dir: string,
  kind: string,
  id: string,
  data: Record<string, any>,
) => {
  const payload = { id, ...data };
  const filePath = join(dir, kind, `${id}.yaml`);
  await writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  return filePath;
};

describe("pipelineV2Validation", () => {
  it("rejects unsafe profile ids", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "api",
      {
        id: "../bad",
        type: "openai_compat",
        base_url: "http://localhost:1234",
        model: "test-model",
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid_id");
  });

  it("requires python parser script or path", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "parser",
      { id: "parser_py", type: "python", options: {} },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_script");
  });

  it("ignores invalid max_retries in pipeline settings", async () => {
    const profilesDir = await createProfilesDir();
    await writeProfile(profilesDir, "api", "api_demo", {
      type: "openai_compat",
      base_url: "http://localhost",
      model: "demo",
    });
    await writeProfile(profilesDir, "prompt", "prompt_demo", {
      user_template: "Use {{source}}",
    });
    await writeProfile(profilesDir, "parser", "parser_demo", {
      type: "regex",
      options: { pattern: "." },
    });
    await writeProfile(profilesDir, "chunk", "chunk_demo", {
      chunk_type: "block",
    });
    const result = await validateProfileLocal(
      "pipeline",
      {
        id: "pipeline_bad_retries",
        provider: "api_demo",
        prompt: "prompt_demo",
        parser: "parser_demo",
        chunk_policy: "chunk_demo",
        settings: { max_retries: -1 },
      },
      profilesDir,
    );
    expect(result.ok).toBe(true);
    expect(result.errors).not.toContain("invalid_max_retries");
  });

  it("rejects invalid chunk options", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "chunk",
      {
        id: "chunk_bad",
        chunk_type: "block",
        options: { target_chars: 0, max_chars: -1, balance_threshold: 2 },
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid_target_chars");
    expect(result.errors).toContain("invalid_max_chars");
    expect(result.errors).toContain("invalid_balance_threshold");
  });

  it("rejects invalid similarity threshold", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "policy",
      {
        id: "policy_bad",
        type: "tolerant",
        options: { similarity_threshold: 1.5 },
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("invalid_similarity_threshold");
  });

  it("rejects prompts without source placeholders", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "prompt",
      { id: "prompt_missing_source", user_template: "Missing placeholder" },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("prompt_missing_source");
  });

  it("requires base_url and model for openai_compat api profiles", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "api",
      { id: "api_missing_fields", type: "openai_compat" },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_base_url");
    expect(result.errors).toContain("missing_model");
  });

  it("validates pool endpoints and numeric fields", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "api",
      {
        id: "api_pool",
        type: "pool",
        endpoints: [{ base_url: "http://localhost" }],
        members: ["legacy"],
        rpm: 0,
        timeout: -5,
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_pool_model");
    expect(result.errors).toContain("pool_members_unsupported");
    expect(result.errors).toContain("invalid_rpm");
    expect(result.errors).toContain("invalid_timeout");
  });

  it("validates parser definitions and warnings", async () => {
    const profilesDir = await createProfilesDir();
    const cases = [
      {
        data: { id: "parser_missing_type" },
        errors: ["missing_field:type"],
      },
      {
        data: { id: "parser_regex", type: "regex", options: {} },
        errors: ["missing_pattern"],
      },
      {
        data: { id: "parser_json_object", type: "json_object", options: {} },
        errors: ["missing_json_path"],
      },
      {
        data: { id: "parser_any", type: "any", options: {} },
        errors: ["missing_any_parsers"],
      },
    ];
    for (const entry of cases) {
      const result = await validateProfileLocal(
        "parser",
        entry.data,
        profilesDir,
      );
      expect(result.ok).toBe(false);
      for (const error of entry.errors) {
        expect(result.errors).toContain(error);
      }
    }

    const warning = await validateProfileLocal(
      "parser",
      { id: "parser_jsonl", type: "jsonl", options: {} },
      profilesDir,
    );
    expect(warning.ok).toBe(true);
    expect(warning.warnings).toContain("missing_json_path");
  });

  it("warns on unsupported policy types", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "policy",
      { id: "policy_custom", type: "custom" },
      profilesDir,
    );
    expect(result.ok).toBe(true);
    expect(result.warnings).toContain("unsupported_type:custom");
  });

  it("validates chunk settings and unsupported types", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "chunk",
      {
        id: "chunk_missing_type",
        options: { target_chars: 10, max_chars: 20 },
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_field:chunk_type");

    const unsupported = await validateProfileLocal(
      "chunk",
      {
        id: "chunk_unsupported",
        chunk_type: "custom",
        options: { target_chars: 30, max_chars: 20, balance_count: 0 },
      },
      profilesDir,
    );
    expect(unsupported.ok).toBe(false);
    expect(unsupported.warnings).toContain("unsupported_type:custom");
    expect(unsupported.errors).toContain("invalid_max_chars");
    expect(unsupported.errors).toContain("invalid_balance_count");
  });

  it("detects missing pipeline references", async () => {
    const profilesDir = await createProfilesDir();
    const result = await validateProfileLocal(
      "pipeline",
      {
        id: "pipeline_missing_refs",
        provider: "api_missing",
        prompt: "prompt_missing",
        parser: "parser_missing",
        chunk_policy: "chunk_missing",
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_reference:api:api_missing");
    expect(result.errors).toContain("missing_reference:prompt:prompt_missing");
    expect(result.errors).toContain("missing_reference:parser:parser_missing");
    expect(result.errors).toContain("missing_reference:chunk:chunk_missing");
  });

  it("enforces line policy rules for pipeline profiles", async () => {
    const profilesDir = await createProfilesDir();
    await writeProfile(profilesDir, "api", "api_ok", {
      type: "openai_compat",
      base_url: "http://localhost",
      model: "demo",
    });
    await writeProfile(profilesDir, "prompt", "prompt_ok", {
      user_template: "Use {{source}}",
    });
    await writeProfile(profilesDir, "parser", "parser_ok", {
      type: "regex",
      options: { pattern: "." },
    });
    await writeProfile(profilesDir, "policy", "policy_ok", {
      type: "strict",
    });
    await writeProfile(profilesDir, "chunk", "chunk_block", {
      chunk_type: "block",
    });
    await writeProfile(profilesDir, "chunk", "chunk_line", {
      chunk_type: "line",
    });

    const blockResult = await validateProfileLocal(
      "pipeline",
      {
        id: "pipeline_block",
        provider: "api_ok",
        prompt: "prompt_ok",
        parser: "parser_ok",
        chunk_policy: "chunk_block",
        line_policy: "policy_ok",
        apply_line_policy: true,
      },
      profilesDir,
    );
    expect(blockResult.ok).toBe(false);
    expect(blockResult.errors).toContain("line_policy_requires_line_chunk");

    const lineResult = await validateProfileLocal(
      "pipeline",
      {
        id: "pipeline_line",
        provider: "api_ok",
        prompt: "prompt_ok",
        parser: "parser_ok",
        chunk_policy: "chunk_line",
      },
      profilesDir,
    );
    expect(lineResult.ok).toBe(false);
    expect(lineResult.errors).toContain("line_chunk_missing_line_policy");
  });

  it("validates prompt and parser pairing rules", async () => {
    const profilesDir = await createProfilesDir();
    await writeProfile(profilesDir, "api", "api_ok", {
      type: "openai_compat",
      base_url: "http://localhost",
      model: "demo",
    });
    await writeProfile(profilesDir, "chunk", "chunk_block", {
      chunk_type: "block",
    });
    await writeProfile(profilesDir, "prompt", "prompt_no_json", {
      user_template: "Use {{source}} only",
    });
    await writeProfile(profilesDir, "parser", "parser_json", {
      type: "json_object",
    });

    const result = await validateProfileLocal(
      "pipeline",
      {
        id: "pipeline_prompt_parser",
        provider: "api_ok",
        prompt: "prompt_no_json",
        parser: "parser_json",
        chunk_policy: "chunk_block",
      },
      profilesDir,
    );
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("parser_requires_json_prompt");
  });

  it("validates pipeline run via profile lookup", async () => {
    const profilesDir = await createProfilesDir();
    const missing = await validatePipelineRun(profilesDir, "pipeline_missing");
    expect(missing.ok).toBe(false);
    expect(missing.errors).toContain(
      "missing_reference:pipeline:pipeline_missing",
    );

    await writeProfile(profilesDir, "pipeline", "pipeline_exists", {
      provider: "api_missing",
      prompt: "prompt_missing",
      parser: "parser_missing",
      chunk_policy: "chunk_missing",
    });
    const result = await validatePipelineRun(profilesDir, "pipeline_exists");
    expect(result.ok).toBe(false);
    expect(result.errors).toContain("missing_reference:api:api_missing");
  });
});
