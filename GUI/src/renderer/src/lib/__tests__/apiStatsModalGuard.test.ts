import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("ApiStatsModal guard", () => {
  const source = readFileSync(
    new URL("../../components/api-manager/ApiStatsModal.tsx", import.meta.url),
    "utf8",
  );

  it("does not use native window.confirm for clearing records", () => {
    expect(source).not.toContain("window.confirm(");
    expect(source).toContain("showConfirm(");
  });

  it("mounts shared AlertModal instance", () => {
    expect(source).toContain("<AlertModal {...alertProps} />");
  });

  it("uses full-row expansion and per-record copy action", () => {
    expect(source).toContain("const [expandedRequestId, setExpandedRequestId]");
    expect(source).toContain("handleCopyRecord");
    expect(source).toContain("window.api?.clipboardWrite");
    expect(source).toContain("colSpan={10}");
    expect(source).not.toContain("<details className=\"group\">");
  });
});
