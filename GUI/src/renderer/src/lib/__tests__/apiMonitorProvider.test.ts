import { describe, expect, it } from "vitest";
import {
  resolveProviderMonitorApiKey,
  resolveProviderMonitorUrl,
} from "../apiMonitorProvider";

describe("apiMonitorProvider helpers", () => {
  it("resolves direct provider base url first", () => {
    expect(
      resolveProviderMonitorUrl({
        base_url: "  https://api.example.com/v1  ",
        endpoints: [{ base_url: "https://fallback.example.com/v1" }],
      }),
    ).toBe("https://api.example.com/v1");
  });

  it("falls back to endpoint base url for pool providers", () => {
    expect(
      resolveProviderMonitorUrl({
        type: "pool",
        endpoints: [
          { base_url: "  " },
          { baseUrl: "https://pool-node.example.com/v1" },
        ],
      }),
    ).toBe("https://pool-node.example.com/v1");
  });

  it("returns empty url when provider has no usable endpoint", () => {
    expect(resolveProviderMonitorUrl({ type: "pool", endpoints: [] })).toBe("");
  });

  it("handles api key as string or list", () => {
    expect(
      resolveProviderMonitorApiKey({
        api_key: "  sk-provider  ",
      }),
    ).toBe("sk-provider");
    expect(
      resolveProviderMonitorApiKey({
        api_key: ["", "  sk-list  "],
      }),
    ).toBe("sk-list");
  });

  it("falls back to endpoint api key when provider-level key is absent", () => {
    expect(
      resolveProviderMonitorApiKey({
        type: "pool",
        endpoints: [
          { base_url: "https://node-a.example.com/v1", api_key: ["", "sk-a"] },
        ],
      }),
    ).toBe("sk-a");
  });
});
