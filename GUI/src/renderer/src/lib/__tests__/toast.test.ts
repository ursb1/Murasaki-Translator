import { describe, it, expect } from "vitest";
import { buildToastMessage } from "../toast";

describe("toast message", () => {
  it("prefers message when provided", () => {
    const result = buildToastMessage({ message: "hello", title: "t" });
    expect(result).toBe("hello");
  });

  it("joins title and description when message is empty", () => {
    const result = buildToastMessage({ title: "Save", description: "Done" });
    expect(result).toBe("Save Done");
  });

  it("returns empty string when no content", () => {
    const result = buildToastMessage({});
    expect(result).toBe("");
  });
});
