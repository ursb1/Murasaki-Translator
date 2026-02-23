import { describe, expect, it } from "vitest";
import {
  normalizeProofreadSaveCacheResult,
  looksLikeWindowsPath,
  resolveProofreadOutputPath,
} from "../proofreadSavePath";

describe("proofreadSavePath helpers", () => {
  it("detects common windows absolute path formats", () => {
    expect(looksLikeWindowsPath("E:\\novel\\book.epub")).toBe(true);
    expect(looksLikeWindowsPath("\\\\server\\share\\book.epub")).toBe(true);
    expect(looksLikeWindowsPath("/mnt/e/novel/book.epub")).toBe(false);
  });

  it("prefers cache output path over derived cache path", () => {
    const resolved = resolveProofreadOutputPath({
      cachePath: "E:\\cache\\book.epub.cache.json",
      cacheOutputPath: "E:\\output\\book.epub",
      isWindows: true,
    });
    expect(resolved).toBe("E:\\output\\book.epub");
  });

  it("falls back to derived path on non-windows", () => {
    const resolved = resolveProofreadOutputPath({
      cachePath: "/tmp/book.epub.cache.json",
      cacheOutputPath: "",
      isWindows: false,
    });
    expect(resolved).toBe("/tmp/book.epub");
  });

  it("returns empty when only non-windows paths are available on windows", () => {
    const resolved = resolveProofreadOutputPath({
      cachePath: "/tmp/book.epub.cache.json",
      cacheOutputPath: "/tmp/book.epub",
      isWindows: true,
    });
    expect(resolved).toBe("");
  });

  it("normalizes boolean save-cache response", () => {
    expect(normalizeProofreadSaveCacheResult(true)).toEqual({
      ok: true,
      path: "",
      error: "",
    });
    expect(normalizeProofreadSaveCacheResult(false)).toEqual({
      ok: false,
      path: "",
      error: "save_cache_failed",
    });
  });

  it("normalizes object save-cache response with fallback path", () => {
    const normalized = normalizeProofreadSaveCacheResult({
      ok: true,
      path: "E:\\output\\book.epub.cache.json",
      warning: "save_cache_fallback_path_used",
    });
    expect(normalized).toEqual({
      ok: true,
      path: "E:\\output\\book.epub.cache.json",
      error: "",
    });
  });

  it("normalizes invalid save-cache response", () => {
    expect(normalizeProofreadSaveCacheResult(undefined)).toEqual({
      ok: false,
      path: "",
      error: "save_cache_no_response",
    });
  });

  it("normalizes object save-cache failure response", () => {
    expect(
      normalizeProofreadSaveCacheResult({
        ok: false,
        error: "EACCES: permission denied",
      }),
    ).toEqual({
      ok: false,
      path: "",
      error: "EACCES: permission denied",
    });
  });
});
