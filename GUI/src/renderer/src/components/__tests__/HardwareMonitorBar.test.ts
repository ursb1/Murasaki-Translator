import { describe, expect, it } from "vitest";
import { HardwareMonitorBar } from "../HardwareMonitorBar";

describe("HardwareMonitorBar", () => {
  it("keeps a unified background color in offline mode", () => {
    const element = HardwareMonitorBar({
      data: null,
      lang: "zh",
    });

    expect(element.props.className).toContain("bg-card");
    expect(element.props.className).not.toContain("bg-muted/30");
    expect(element.props.className).not.toContain("dark:bg-muted/20");
  });
});
