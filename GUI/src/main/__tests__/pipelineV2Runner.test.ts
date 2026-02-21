import { describe, expect, it } from "vitest";
import { __testOnly } from "../pipelineV2Runner";

describe("pipelineV2Runner buffered output", () => {
  it("flushes complete lines and preserves tail", () => {
    const lines: string[] = [];
    const remaining = __testOnly.flushBufferedLines(
      "first\n\nsecond\r\npartial",
      (line) => lines.push(line),
    );

    expect(lines).toEqual(["first", "second"]);
    expect(remaining).toBe("partial");
  });

  it("clears buffer when input ends with newline", () => {
    const lines: string[] = [];
    const remaining = __testOnly.flushBufferedLines("alpha\nbeta\n", (line) =>
      lines.push(line),
    );

    expect(lines).toEqual(["alpha", "beta"]);
    expect(remaining).toBe("");
  });
});
