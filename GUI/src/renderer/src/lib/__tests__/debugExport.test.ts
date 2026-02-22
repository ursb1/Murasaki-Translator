import { describe, expect, it } from "vitest";

import {
  buildV2DebugSnapshot,
  collectV2StorageDebug,
  isSensitiveDebugKey,
  redactSensitiveConfigData,
  redactSensitiveDebugValue,
} from "../debugExport";

const createStorage = (initial: Record<string, string>): Storage => {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
};

describe("debug export helpers", () => {
  it("detects sensitive keys", () => {
    expect(isSensitiveDebugKey("config_api_key")).toBe(true);
    expect(isSensitiveDebugKey("baseUrl")).toBe(true);
    expect(isSensitiveDebugKey("url")).toBe(true);
    expect(isSensitiveDebugKey("model")).toBe(false);
  });

  it("redacts sensitive fields recursively", () => {
    const sanitized = redactSensitiveDebugValue({
      model: "gpt-4.1-mini",
      api_key: "sk-demo",
      base_url: "https://api.example.com/v1",
      nested: {
        url: "https://inner.example.com",
        authorization: "Bearer abcdefg12345",
        keep: "ok",
      },
    }) as Record<string, unknown>;

    expect(sanitized.model).toBe("gpt-4.1-mini");
    expect(sanitized.api_key).toBe("[REDACTED]");
    expect(sanitized.base_url).toBe("[REDACTED]");
    expect((sanitized.nested as Record<string, unknown>).url).toBe(
      "[REDACTED]",
    );
    expect((sanitized.nested as Record<string, unknown>).authorization).toBe(
      "[REDACTED]",
    );
    expect((sanitized.nested as Record<string, unknown>).keep).toBe("ok");
  });

  it("redacts sensitive config values by key", () => {
    const result = redactSensitiveConfigData({
      config_api_key: "sk-123",
      config_remote_url: "https://example.com",
      config_output_dir: "C:/output",
      config_model: "gpt-4.1-mini",
    });

    expect(result.config_api_key).toBe("[REDACTED]");
    expect(result.config_remote_url).toBe("[REDACTED]");
    expect(result.config_output_dir).toBe("C:/output");
    expect(result.config_model).toBe("gpt-4.1-mini");
  });

  it("collects and sanitizes murasaki.v2 localStorage entries", () => {
    const storage = createStorage({
      "murasaki.v2.active_pipeline_id": '"pipeline_demo"',
      "murasaki.v2.custom_templates": JSON.stringify({
        api: [
          {
            id: "api_template",
            yaml: "base_url: https://api.example.com/v1\napi_key: sk-xxx",
          },
        ],
      }),
      config_model: "gpt-4.1-mini",
    });

    const result = collectV2StorageDebug(storage);

    expect(result["murasaki.v2.active_pipeline_id"]).toBe("pipeline_demo");
    const templates = result["murasaki.v2.custom_templates"] as Record<
      string,
      unknown
    >;
    const apiTemplates = templates.api as Array<Record<string, unknown>>;
    expect(apiTemplates[0].yaml).toContain("base_url: [REDACTED]");
    expect(apiTemplates[0].yaml).toContain("api_key: [REDACTED]");
    expect(result.config_model).toBeUndefined();
  });

  it("builds v2 profile snapshot and redacts api key/url", async () => {
    const storage = createStorage({
      "murasaki.v2.active_pipeline_id": '"pipeline_demo"',
    });

    const snapshot = await buildV2DebugSnapshot(
      {
        pipelineV2ProfilesList: async (kind: string) => {
          if (kind === "api") return [{ id: "api_demo", name: "API Demo" }];
          if (kind === "pipeline") {
            return [{ id: "pipeline_demo", name: "Pipeline Demo" }];
          }
          return [];
        },
        pipelineV2ProfilesLoadBatch: async (kind: string, ids: string[]) =>
          ids.map((id) => {
            if (kind === "api") {
              return {
                id,
                result: {
                  id,
                  name: "API Demo",
                  data: {
                    base_url: "https://api.example.com/v1",
                    api_key: "sk-demo",
                    model: "gpt-4.1-mini",
                  },
                },
              };
            }
            if (kind === "pipeline") {
              return {
                id,
                result: {
                  id,
                  name: "Pipeline Demo",
                  data: {
                    provider: "api_demo",
                    parser: "parser_any_default",
                  },
                },
              };
            }
            return { id, result: null };
          }),
      },
      storage,
    );

    expect(snapshot.errors).toEqual({});
    expect(snapshot.storage["murasaki.v2.active_pipeline_id"]).toBe(
      "pipeline_demo",
    );
    expect(snapshot.profiles.api).toHaveLength(1);
    expect(snapshot.profiles.pipeline).toHaveLength(1);
    expect(snapshot.profiles.api[0].data).toMatchObject({
      base_url: "[REDACTED]",
      api_key: "[REDACTED]",
      model: "gpt-4.1-mini",
    });
    expect(snapshot.profiles.pipeline[0].data).toMatchObject({
      provider: "api_demo",
      parser: "parser_any_default",
    });
  });
});
