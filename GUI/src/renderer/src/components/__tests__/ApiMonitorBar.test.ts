import { describe, expect, it } from "vitest";
import { ApiMonitorBar } from "../ApiMonitorBar";

const collectClassNames = (node: unknown, acc: string[] = []): string[] => {
  if (!node) return acc;
  if (Array.isArray(node)) {
    node.forEach((child) => collectClassNames(child, acc));
    return acc;
  }
  if (typeof node !== "object") return acc;
  const props = (node as { props?: Record<string, unknown> }).props;
  const className = props?.className;
  if (typeof className === "string") acc.push(className);
  if (props?.children) collectClassNames(props.children, acc);
  return acc;
};

describe("ApiMonitorBar", () => {
  it("keeps extra right spacing on the container", () => {
    const element = ApiMonitorBar({
      data: {
        url: "http://127.0.0.1:8000",
        latencyMs: 120,
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
        latencyMs: null,
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

  it("uses warn/bad colors for high RPM", () => {
    const warnElement = ApiMonitorBar({
      data: {
        url: "http://127.0.0.1:8000",
        latencyMs: 120,
        rpm: 150,
        concurrency: 2,
      },
      lang: "zh",
      isRunning: true,
    });
    const warnClasses = collectClassNames(warnElement);
    expect(
      warnClasses.some(
        (className) =>
          className.includes("w-10") && className.includes("text-amber-500"),
      ),
    ).toBe(true);

    const badElement = ApiMonitorBar({
      data: {
        url: "http://127.0.0.1:8000",
        latencyMs: 120,
        rpm: 600,
        concurrency: 2,
      },
      lang: "zh",
      isRunning: true,
    });
    const badClasses = collectClassNames(badElement);
    expect(
      badClasses.some(
        (className) =>
          className.includes("w-10") && className.includes("text-rose-500"),
      ),
    ).toBe(true);
  });
});
