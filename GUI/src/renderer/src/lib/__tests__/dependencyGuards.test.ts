import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readSource = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

describe("dependency guards", () => {
  it("sidebar should not import View type from App", () => {
    const source = readSource("src/renderer/src/components/Sidebar.tsx");
    expect(source.includes('import type { View } from "../App";')).toBe(false);
  });

  it("result checker should not expose orphan default export", () => {
    const source = readSource("src/renderer/src/components/ResultChecker.tsx");
    expect(source.includes("export default ResultChecker;")).toBe(false);
  });

  it("app view union and valid view list should not include shadow service view", () => {
    const source = readSource("src/renderer/src/App.tsx");
    expect(source.includes('| "service"')).toBe(false);
    expect(source.includes('"service",')).toBe(false);
  });
});
