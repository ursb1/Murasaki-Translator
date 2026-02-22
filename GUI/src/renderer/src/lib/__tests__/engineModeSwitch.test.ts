import { describe, it, expect, vi } from "vitest";
import {
  applyFileEngineMode,
  resolveQueueItemEngineMode,
  resolveQueueItemPipelineId,
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

  it("uses explicit file-level mode when provided", () => {
    expect(
      resolveQueueItemEngineMode(
        { config: { useGlobalDefaults: true, engineMode: "v1" } },
        "v2",
      ),
    ).toBe("v1");
  });

  it("uses global mode when following global defaults without explicit mode", () => {
    expect(
      resolveQueueItemEngineMode({ config: { useGlobalDefaults: true } }, "v2"),
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

describe("applyFileEngineMode", () => {
  it("updates engine mode without mutating useGlobalDefaults", () => {
    const next = applyFileEngineMode(
      { useGlobalDefaults: true, engineMode: "v1" },
      "v2",
    );
    expect(next.engineMode).toBe("v2");
    expect(next.useGlobalDefaults).toBe(true);
  });

  it("keeps file-local override state when switching back", () => {
    const next = applyFileEngineMode(
      { useGlobalDefaults: false, engineMode: "v2" },
      "v1",
    );
    expect(next.engineMode).toBe("v1");
    expect(next.useGlobalDefaults).toBe(false);
  });
});

describe("resolveQueueItemPipelineId", () => {
  it("uses file-level pipeline id when provided", () => {
    expect(
      resolveQueueItemPipelineId(
        { config: { useGlobalDefaults: true, v2PipelineId: "file-pipe" } },
        "global-pipe",
      ),
    ).toBe("file-pipe");
  });

  it("falls back to global pipeline id when file-level is missing", () => {
    expect(
      resolveQueueItemPipelineId(
        { config: { useGlobalDefaults: false } },
        "global-pipe",
      ),
    ).toBe("global-pipe");
  });

  it("trims both file-level and global pipeline ids", () => {
    expect(
      resolveQueueItemPipelineId(
        { config: { v2PipelineId: "  file-pipe  " } },
        "  global-pipe  ",
      ),
    ).toBe("file-pipe");
    expect(resolveQueueItemPipelineId(undefined, "  global-pipe  ")).toBe(
      "global-pipe",
    );
  });
});
