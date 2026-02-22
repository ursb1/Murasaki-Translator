import { describe, expect, it } from "vitest";
import {
  formatProgressCount,
  formatProgressPercent,
} from "../progressDisplay";

describe("formatProgressCount", () => {
  it("formats current and total with separators", () => {
    expect(formatProgressCount(183, 1879)).toBe("183 / 1,879");
  });

  it("normalizes invalid values to zero", () => {
    expect(formatProgressCount(undefined, NaN)).toBe("0 / 0");
  });

  it("clamps negative values to zero", () => {
    expect(formatProgressCount(-3, -8)).toBe("0 / 0");
  });
});

describe("formatProgressPercent", () => {
  it("formats percent with one decimal place", () => {
    expect(formatProgressPercent(7.94)).toBe("7.9%");
  });

  it("normalizes invalid values to zero percent", () => {
    expect(formatProgressPercent(null)).toBe("0.0%");
  });
});

