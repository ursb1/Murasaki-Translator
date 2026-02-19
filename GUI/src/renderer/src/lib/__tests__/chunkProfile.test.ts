import { describe, it, expect } from "vitest";
import { normalizeChunkType } from "../chunkProfile";

describe("chunkProfile helpers", () => {
  it("forces legacy chunk type", () => {
    expect(normalizeChunkType("legacy")).toBe("legacy");
    expect(normalizeChunkType("line")).toBe("legacy");
    expect(normalizeChunkType("")).toBe("legacy");
    expect(normalizeChunkType(null)).toBe("legacy");
  });
});
