import { describe, expect, it } from "vitest";
import { __testOnly, formatScanDirectoryFailure } from "../ipcDiagnostics";

describe("ipcDiagnostics", () => {
  it("formats scan-directory failure for standard errors", () => {
    const message = formatScanDirectoryFailure(
      "E:/input/books",
      new Error("permission denied"),
    );
    expect(message).toBe(
      "scan-directory failed for E:/input/books: permission denied",
    );
  });

  it("falls back to unknown path and stringified error", () => {
    const message = formatScanDirectoryFailure("", 404);
    expect(message).toBe("scan-directory failed for <unknown>: 404");
  });

  it("normalizes unknown errors via shared helper", () => {
    expect(__testOnly.toErrorMessage("oops")).toBe("oops");
    expect(__testOnly.toErrorMessage(new Error("boom"))).toBe("boom");
  });
});
