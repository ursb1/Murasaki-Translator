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
});
