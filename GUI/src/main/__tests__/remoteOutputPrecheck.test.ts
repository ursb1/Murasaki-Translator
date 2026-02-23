import { describe, expect, it } from "vitest";
import {
  __testOnly,
  resolveRemoteOutputPrecheck,
} from "../remoteOutputPrecheck";

describe("remoteOutputPrecheck", () => {
  it("skips local probe for non-loopback remote execution", () => {
    const result = resolveRemoteOutputPrecheck({
      executionMode: "remote",
      remoteUrl: "https://example.com:9000/api/v1",
    });
    expect(result).toEqual({
      skipLocalProbe: true,
      remoteHost: "example.com",
    });
  });

  it("does not skip local probe for localhost remote execution", () => {
    const result = resolveRemoteOutputPrecheck({
      executionMode: "remote",
      remoteUrl: "http://127.0.0.1:8000",
    });
    expect(result).toEqual({ skipLocalProbe: false });
  });

  it("does not skip local probe for malformed remote url", () => {
    const result = resolveRemoteOutputPrecheck({
      executionMode: "remote",
      remoteUrl: "not-a-url",
    });
    expect(result).toEqual({ skipLocalProbe: false });
  });

  it("normalizes loopback host helper", () => {
    expect(__testOnly.isLoopbackHost("localhost")).toBe(true);
    expect(__testOnly.isLoopbackHost("127.0.0.1")).toBe(true);
    expect(__testOnly.isLoopbackHost("example.com")).toBe(false);
  });
});
