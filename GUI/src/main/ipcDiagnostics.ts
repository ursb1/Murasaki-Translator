const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const formatScanDirectoryFailure = (
  targetPath: string,
  error: unknown,
): string => {
  const normalizedPath =
    typeof targetPath === "string" && targetPath.trim()
      ? targetPath
      : "<unknown>";
  return `scan-directory failed for ${normalizedPath}: ${toErrorMessage(error)}`;
};

export const __testOnly = {
  toErrorMessage,
};
