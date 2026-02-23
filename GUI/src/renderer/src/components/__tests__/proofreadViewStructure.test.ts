import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readProofreadViewSource = () =>
  readFileSync(
    fileURLToPath(new URL("../ProofreadView.tsx", import.meta.url)),
    "utf-8",
  );

describe("ProofreadView structure regressions", () => {
  it("keeps textareaRef wired to editable textareas", () => {
    const content = readProofreadViewSource();
    const refMatches = content.match(/ref=\{textareaRef\}/g) || [];
    expect(refMatches.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps only one log auto-scroll effect guard", () => {
    const content = readProofreadViewSource();
    const guards =
      content.match(/if \(showLogModal !== null && logScrollRef\.current\)/g) ||
      [];
    expect(guards.length).toBe(1);
  });
});
