import { describe, it, expect, vi } from "vitest";
import { shouldIgnoreEngineModeToggle } from "../engineModeSwitch";

describe("shouldIgnoreEngineModeToggle", () => {
  it("returns false for null targets", () => {
    expect(shouldIgnoreEngineModeToggle(null)).toBe(false);
  });

  it("returns false when target does not expose closest", () => {
    expect(shouldIgnoreEngineModeToggle({} as unknown as EventTarget)).toBe(
      false,
    );
  });

  it("returns true when closest selector is matched", () => {
    const closest = vi.fn().mockReturnValue({});
    const target = { closest } as unknown as EventTarget;

    expect(shouldIgnoreEngineModeToggle(target)).toBe(true);
    expect(closest).toHaveBeenCalledTimes(1);
    expect(closest.mock.calls[0][0]).toContain("select");
    expect(closest.mock.calls[0][0]).toContain(
      "[data-engine-switch-ignore='true']",
    );
  });

  it("returns false when closest selector is not matched", () => {
    const target = {
      closest: vi.fn().mockReturnValue(null),
    } as unknown as EventTarget;

    expect(shouldIgnoreEngineModeToggle(target)).toBe(false);
  });
});
