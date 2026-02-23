import { describe, expect, it } from "vitest";
import { __testOnly } from "../useRemoteRuntime";
import { translations } from "../../lib/i18n";

describe("useRemoteRuntime i18n token resolver", () => {
  it("resolves notice token in zh/en/jp", () => {
    for (const lang of [translations.zh, translations.en, translations.jp]) {
      const text = __testOnly.resolveRemoteRuntimeToken(
        "i18n:remoteRuntime.noticeModeEnabled",
        lang.remoteRuntime,
      );
      expect(text).toBe(lang.remoteRuntime.noticeModeEnabled);
    }
  });

  it("resolves hint token with message placeholder", () => {
    const encoded = encodeURIComponent("HTTP 524 timeout");
    const value = __testOnly.resolveRemoteRuntimeToken(
      `i18n:remoteRuntime.hintLatestNetworkError|${encoded}`,
      translations.en.remoteRuntime,
    );
    expect(value).toContain("HTTP 524 timeout");
    expect(value).toContain("Latest network error");
  });

  it("resolves multiline hint tokens", () => {
    const value = __testOnly.resolveRemoteRuntimeHint(
      [
        "i18n:remoteRuntime.hintNetwork",
        "i18n:remoteRuntime.hintOpenDetails",
      ].join("\n"),
      translations.zh.remoteRuntime,
    );
    expect(value).toContain("网络不可达");
    expect(value).toContain("远程运行详情");
  });
});
