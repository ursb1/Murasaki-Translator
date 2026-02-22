import { describe, expect, it } from "vitest";
import {
  extractSandboxParserCandidates,
  resolveSandboxFailedTab,
} from "../sandboxDisplay";

describe("resolveSandboxFailedTab", () => {
  it("maps parser stage to parsed tab", () => {
    expect(resolveSandboxFailedTab("parser")).toBe("parsed");
  });

  it("maps request-related stages to request tab", () => {
    expect(resolveSandboxFailedTab("prompt")).toBe("request");
    expect(resolveSandboxFailedTab("request")).toBe("request");
  });

  it("returns empty when stage is unknown", () => {
    expect(resolveSandboxFailedTab("")).toBe("");
    expect(resolveSandboxFailedTab("other")).toBe("");
  });
});

describe("extractSandboxParserCandidates", () => {
  it("returns normalized candidate list", () => {
    expect(
      extractSandboxParserCandidates({
        candidates: ["jsonl: invalid", " regex: not match ", ""],
      }),
    ).toEqual(["jsonl: invalid", "regex: not match"]);
  });

  it("returns empty array for non-object payload", () => {
    expect(extractSandboxParserCandidates(null)).toEqual([]);
    expect(extractSandboxParserCandidates("x")).toEqual([]);
  });
});
