import { describe, expect, it } from "vitest";
import { __testOnly } from "../ProofreadView";

describe("ProofreadView search consistency helpers", () => {
  const blocks = [
    {
      index: 0,
      src: "角色A",
      dst: "foo-123",
      status: "processed" as const,
      warnings: [],
      cot: "",
      srcLines: 1,
      dstLines: 1,
    },
    {
      index: 1,
      src: "角色B",
      dst: "bar-456",
      status: "processed" as const,
      warnings: [],
      cot: "",
      srcLines: 1,
      dstLines: 1,
    },
  ];

  it("regex 搜索与过滤口径一致", () => {
    const keyword = "^foo-\\d+$";
    const scan = __testOnly.collectSearchMatches(blocks, keyword, true);
    expect(scan.error).toBeNull();
    expect(scan.matches).toHaveLength(1);
    expect(scan.matches[0]).toMatchObject({
      blockIndex: 0,
      type: "dst",
      lineIndex: 0,
    });

    const filtered = blocks.filter(
      (block) => __testOnly.blockMatchesSearchKeyword(block, keyword, true).matched,
    );
    expect(filtered.map((item) => item.index)).toEqual([0]);
  });

  it("非法正则返回错误并避免过滤列表", () => {
    const keyword = "(";
    const scan = __testOnly.collectSearchMatches(blocks, keyword, true);
    expect(scan.error).toBeTruthy();
    expect(scan.matches).toHaveLength(0);

    const filterState = __testOnly.blockMatchesSearchKeyword(
      blocks[0],
      keyword,
      true,
    );
    expect(filterState.error).toBeTruthy();
    expect(filterState.matched).toBe(true);
  });
});

describe("ProofreadView consistency scan helper", () => {
  it("输出多变体术语问题并上报进度", async () => {
    const selectedFiles = [
      {
        path: "/tmp/a.cache.json",
        name: "a.cache.json",
        date: "2026-02-23",
      },
    ];
    const progress: number[] = [];
    const result = await __testOnly.runConsistencyScan({
      selectedFiles,
      glossaryMap: { 太郎: "太郎" },
      minOccurrences: 1,
      unknownLabel: "UNKNOWN",
      loadCache: async () => ({
        blocks: [
          {
            index: 0,
            src: "太郎",
            dst: "太郎",
            status: "processed",
            warnings: [],
            cot: "",
            srcLines: 1,
            dstLines: 1,
          },
          {
            index: 1,
            src: "太郎",
            dst: "太朗",
            status: "processed",
            warnings: [],
            cot: "",
            srcLines: 1,
            dstLines: 1,
          },
        ],
      }),
      onProgress: (value) => progress.push(value),
    });

    expect(progress).toEqual([1]);
    expect(result.stats).toMatchObject({
      files: 1,
      terms: 1,
      issues: 1,
    });
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.term).toBe("太郎");
    expect(result.issues[0]?.variants.map((item) => item.text)).toEqual(
      expect.arrayContaining(["太郎", "太朗"]),
    );
  });
});
