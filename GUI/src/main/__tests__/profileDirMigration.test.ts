import { describe, expect, it } from "vitest";
import { resolveProfilesDirWithLegacyFallback } from "../profileDirMigration";

const createFsMock = (existingPaths: string[] = []) => {
  const paths = new Set(existingPaths);
  const mkdirCalls: string[] = [];
  const renameCalls: Array<{ from: string; to: string }> = [];

  return {
    fsLike: {
      existsSync: (path: string) => paths.has(path),
      mkdirSync: (path: string) => {
        mkdirCalls.push(path);
        paths.add(path);
      },
      renameSync: (from: string, to: string) => {
        renameCalls.push({ from, to });
        paths.delete(from);
        paths.add(to);
      },
    },
    mkdirCalls,
    renameCalls,
  };
};

describe("profileDirMigration", () => {
  it("migrates legacy dir via rename when target is missing", () => {
    const profilesDir = "/app/profiles";
    const legacyDir = "/app/legacy_profiles";
    const mock = createFsMock([legacyDir]);

    const result = resolveProfilesDirWithLegacyFallback({
      profilesDir,
      legacyDir,
      fsLike: mock.fsLike,
    });

    expect(result).toEqual({
      activeDir: profilesDir,
      usedLegacyFallback: false,
    });
    expect(mock.renameCalls).toEqual([{ from: legacyDir, to: profilesDir }]);
  });

  it("falls back to legacy dir when rename fails", () => {
    const profilesDir = "/app/profiles";
    const legacyDir = "/app/legacy_profiles";
    const mock = createFsMock([legacyDir]);
    mock.fsLike.renameSync = () => {
      throw new Error("rename failed");
    };

    const result = resolveProfilesDirWithLegacyFallback({
      profilesDir,
      legacyDir,
      fsLike: mock.fsLike,
    });

    expect(result).toEqual({
      activeDir: legacyDir,
      usedLegacyFallback: true,
    });
  });

  it("ensures active directory exists", () => {
    const profilesDir = "/app/profiles";
    const legacyDir = "/app/legacy_profiles";
    const mock = createFsMock([]);

    const result = resolveProfilesDirWithLegacyFallback({
      profilesDir,
      legacyDir,
      fsLike: mock.fsLike,
    });

    expect(result.activeDir).toBe(profilesDir);
    expect(mock.mkdirCalls).toContain(profilesDir);
  });
});
