const WINDOWS_ABSOLUTE_PATH_RE = /^[a-zA-Z]:[\\/]/;
const WINDOWS_UNC_PATH_RE = /^\\\\/;

const trimString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const looksLikeWindowsPath = (value: unknown): boolean => {
  const target = trimString(value);
  return (
    WINDOWS_ABSOLUTE_PATH_RE.test(target) || WINDOWS_UNC_PATH_RE.test(target)
  );
};

export const resolveProofreadOutputPath = ({
  cachePath,
  cacheOutputPath,
  isWindows,
}: {
  cachePath: string;
  cacheOutputPath?: string;
  isWindows: boolean;
}): string => {
  const normalizedCachePath = trimString(cachePath);
  const normalizedCacheOutput = trimString(cacheOutputPath);
  const derivedFromCache = normalizedCachePath.match(/\.cache\.json$/i)
    ? normalizedCachePath.replace(/\.cache\.json$/i, "")
    : "";

  const candidates = [normalizedCacheOutput, derivedFromCache].filter(
    (item, index, list) => item && list.indexOf(item) === index,
  );
  if (candidates.length === 0) return "";

  if (!isWindows) {
    return candidates[0];
  }
  return candidates.find((item) => looksLikeWindowsPath(item)) || "";
};

type SaveCacheResultRaw =
  | boolean
  | {
      ok?: boolean;
      success?: boolean;
      path?: string;
      cachePath?: string;
      error?: string;
      warning?: string;
    };

export const normalizeProofreadSaveCacheResult = (value: unknown) => {
  const raw = value as SaveCacheResultRaw;
  if (typeof raw === "boolean") {
    return {
      ok: raw,
      path: "",
      error: raw ? "" : "save_cache_failed",
    };
  }
  if (!raw || typeof raw !== "object") {
    return {
      ok: false,
      path: "",
      error: "save_cache_no_response",
    };
  }
  const ok = raw.ok === true || raw.success === true;
  const path = trimString(raw.path || raw.cachePath || "");
  const error = trimString(raw.error || "");
  return {
    ok,
    path,
    error: ok ? "" : error || "save_cache_failed",
  };
};
