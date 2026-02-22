import { describe, expect, it } from "vitest";

import {
  filterWatchFilesByTypes,
  isLikelyTranslatedOutput,
  normalizeWatchFileTypes,
  normalizeWatchFolderConfig,
} from "../watchFolder";

describe("watchFolder helpers", () => {
  it("normalizes file type inputs", () => {
    expect(normalizeWatchFileTypes([" .TXT ", ".Srt", "", "  "])).toEqual([
      "txt",
      "srt",
    ]);
  });

  it("normalizes watch folder config defaults", () => {
    expect(
      normalizeWatchFolderConfig({
        id: "watch-1",
        path: "  C:/Media  ",
        fileTypes: [".TXT"],
      }),
    ).toEqual({
      id: "watch-1",
      path: "C:/Media",
      includeSubdirs: false,
      enabled: true,
      fileTypes: ["txt"],
      createdAt: undefined,
    });
  });

  it("filters paths by configured types and supported extensions", () => {
    const paths = ["a.srt", "b.txt", "c.doc", "d.SRT"];
    const supported = [".srt", ".txt"];

    expect(filterWatchFilesByTypes(paths, ["SRT"], supported)).toEqual([
      "a.srt",
      "d.SRT",
    ]);
    expect(filterWatchFilesByTypes(paths, [], supported)).toEqual([
      "a.srt",
      "b.txt",
      "d.SRT",
    ]);
  });

  it("detects likely translated outputs by suffix and model name", () => {
    const supported = [".srt", ".txt"];
    expect(
      isLikelyTranslatedOutput("movie_translated.srt", ["ModelA"], supported),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput("movie_modela.srt", ["ModelA.gguf"], supported),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput("movie_modela.doc", ["ModelA"], supported),
    ).toBe(false);
  });

  it("detects likely translated outputs by v2 provider_model suffix", () => {
    const supported = [".srt", ".txt"];
    expect(
      isLikelyTranslatedOutput("movie_openai_gpt-4.1-mini.srt", [], supported, [
        "openai",
      ]),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput(
        "movie_deepseek-ai_DeepSeek-V3.srt",
        [],
        supported,
        ["deepseek-ai"],
      ),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput(
        "movie_customProvider_claude-3-7.txt",
        [],
        supported,
        ["customProvider"],
      ),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput("movie_sample-provider_sample-model.srt", [], supported, [
        "another_provider",
      ]),
    ).toBe(false);
  });

  it("falls back to provider/model heuristic when provider list is unavailable", () => {
    const supported = [".txt"];
    expect(
      isLikelyTranslatedOutput("test2_deepseek-ai_DeepSeek-V3.txt", [], supported),
    ).toBe(true);
    expect(
      isLikelyTranslatedOutput("chapter_part-1_section-2.txt", [], supported),
    ).toBe(false);
  });
});
