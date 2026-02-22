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

describe("pipelineV2Runner bundle args", () => {
  it("uses script path when bundle path points to plain python interpreter", () => {
    const args = ["main.py", "--file", "demo.txt"];
    expect(__testOnly.resolveBundleArgs("python3", args)).toEqual(args);
    expect(__testOnly.resolveBundleArgs("python.exe", args)).toEqual(args);
  });

  it("drops script path when using packaged bundle executable", () => {
    const args = ["main.py", "--file", "demo.txt"];
    expect(__testOnly.resolveBundleArgs("murasaki-engine", args)).toEqual([
      "--file",
      "demo.txt",
    ]);
  });
});
