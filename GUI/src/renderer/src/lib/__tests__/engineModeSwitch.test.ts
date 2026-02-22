import { describe, it, expect, vi } from "vitest";
import {
  resolveQueueItemEngineMode,
  shouldIgnoreEngineModeToggle,
} from "../engineModeSwitch";

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

describe("resolveQueueItemEngineMode", () => {
  it("uses global mode when queue item is missing", () => {
    expect(resolveQueueItemEngineMode(undefined, "v2")).toBe("v2");
  });

  it("uses global mode when file config follows global defaults", () => {
    expect(
      resolveQueueItemEngineMode(
        { config: { useGlobalDefaults: true, engineMode: "v1" } },
        "v2",
      ),
    ).toBe("v2");
  });

  it("uses file-level mode when global defaults are disabled", () => {
    expect(
      resolveQueueItemEngineMode(
        { config: { useGlobalDefaults: false, engineMode: "v1" } },
        "v2",
      ),
    ).toBe("v1");
    expect(
      resolveQueueItemEngineMode(
        { config: { useGlobalDefaults: false, engineMode: "v2" } },
        "v1",
      ),
    ).toBe("v2");
  });

  it("falls back to global mode when file-level mode is missing", () => {
    expect(
      resolveQueueItemEngineMode(
        { config: { useGlobalDefaults: false } },
        "v1",
      ),
    ).toBe("v1");
  });
});
