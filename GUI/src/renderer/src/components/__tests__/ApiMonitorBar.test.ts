import { describe, expect, it } from "vitest";
import { ApiMonitorBar } from "../ApiMonitorBar";

describe("ApiMonitorBar", () => {
  it("keeps extra right spacing on the container", () => {
    const element = ApiMonitorBar({
      data: {
        url: "http://127.0.0.1:8000",
        ping: 120,
        rpm: 12,
        concurrency: 2,
      },
      lang: "zh",
      isRunning: true,
    });

    expect(element.props.className).toContain("pl-3");
    expect(element.props.className).toContain("pr-5");
  });

  it("keeps a unified background color in offline mode", () => {
    const element = ApiMonitorBar({
      data: {
        url: "",
        ping: null,
        rpm: 0,
        concurrency: 0,
      },
      lang: "zh",
      isRunning: false,
    });

    expect(element.props.className).toContain("bg-card");
    expect(element.props.className).not.toContain("bg-muted/30");
    expect(element.props.className).not.toContain("dark:bg-muted/20");
  });
});
