import { dirname } from "path";

type FsLike = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, options?: { recursive?: boolean }) => void;
  renameSync: (oldPath: string, newPath: string) => void;
};

export interface ResolveProfilesDirInput {
  profilesDir: string;
  legacyDir: string;
  fsLike: FsLike;
}

export interface ResolveProfilesDirResult {
  activeDir: string;
  usedLegacyFallback: boolean;
}

export const resolveProfilesDirWithLegacyFallback = (
  input: ResolveProfilesDirInput,
): ResolveProfilesDirResult => {
  const { profilesDir, legacyDir, fsLike } = input;
  let activeDir = profilesDir;
  let usedLegacyFallback = false;

  if (
    legacyDir !== profilesDir &&
    fsLike.existsSync(legacyDir) &&
    !fsLike.existsSync(profilesDir)
  ) {
    try {
      fsLike.mkdirSync(dirname(profilesDir), { recursive: true });
      fsLike.renameSync(legacyDir, profilesDir);
    } catch {
      // Fall back to legacy dir when migration cannot be completed immediately.
      activeDir = legacyDir;
      usedLegacyFallback = true;
    }
  }

  if (!fsLike.existsSync(activeDir)) {
    fsLike.mkdirSync(activeDir, { recursive: true });
  }

  return {
    activeDir,
    usedLegacyFallback,
  };
};
