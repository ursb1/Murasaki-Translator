export type WatchFolderConfigInput = {
  id: string;
  path: string;
  includeSubdirs?: boolean;
  fileTypes?: string[];
  enabled?: boolean;
  createdAt?: string;
};

export type WatchFolderConfig = {
  id: string;
  path: string;
  includeSubdirs: boolean;
  fileTypes: string[];
  enabled: boolean;
  createdAt?: string;
};

export const normalizeWatchFileTypes = (types?: string[]) =>
  (types || [])
    .map((type) => type.trim().toLowerCase().replace(/^\./, ""))
    .filter(Boolean);

export const normalizeWatchFolderConfig = (
  entry: WatchFolderConfigInput,
): WatchFolderConfig => ({
  id: entry.id,
  path: String(entry.path || "").trim(),
  includeSubdirs: Boolean(entry.includeSubdirs),
  enabled: entry.enabled !== false,
  fileTypes: normalizeWatchFileTypes(entry.fileTypes),
  createdAt: entry.createdAt,
});

export const filterWatchFilesByTypes = (
  paths: string[],
  types: string[],
  supportedExtensions: string[],
) => {
  const normalizedTypes = normalizeWatchFileTypes(types);
  const allowed = new Set(normalizedTypes);
  const supported = new Set(
    (supportedExtensions || []).map((ext) => ext.toLowerCase()),
  );
  return (paths || []).filter((path) => {
    const ext = "." + (path.split(".").pop() || "").toLowerCase();
    if (!supported.has(ext)) return false;
    if (allowed.size === 0) return true;
    return allowed.has(ext.slice(1));
  });
};

export const isLikelyTranslatedOutput = (
  filePath: string,
  modelNames: string[],
  supportedExtensions: string[],
  providerNames: string[] = [],
) => {
  const providerHints = [
    "openai",
    "deepseek",
    "anthropic",
    "google",
    "xai",
    "azure",
    "groq",
    "cohere",
    "mistral",
    "moonshot",
    "minimax",
    "zhipu",
    "baidu",
    "siliconflow",
    "volcengine",
    "aliyun",
    "hunyuan",
    "openrouter",
  ];
  const normalizeSuffixToken = (value: string) =>
    String(value || "")
      .trim()
      .replace(/\.gguf$/i, "")
      .replace(/[\\/*?:"<>|]/g, "_")
      .toLowerCase();
  const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const fileName = (filePath || "").split(/[/\\]/).pop() || "";
  const lowerName = fileName.toLowerCase();
  const extIndex = lowerName.lastIndexOf(".");
  const ext = extIndex >= 0 ? lowerName.slice(extIndex) : "";
  if (!supportedExtensions.map((e) => e.toLowerCase()).includes(ext)) {
    return false;
  }
  const baseName =
    extIndex >= 0 ? fileName.slice(0, fileName.length - ext.length) : fileName;
  const baseLower = baseName.toLowerCase();
  if (baseLower.endsWith("_translated")) return true;
  for (const model of modelNames || []) {
    const normalized = normalizeSuffixToken(model);
    if (!normalized) continue;
    if (baseLower.endsWith(`_${normalized}`)) return true;
  }
  for (const provider of providerNames || []) {
    const normalized = normalizeSuffixToken(provider);
    if (!normalized) continue;
    const v2SuffixPattern = new RegExp(
      `_${escapeRegex(normalized)}_[^_].+$`,
      "i",
    );
    if (v2SuffixPattern.test(baseName)) return true;
  }

  // Fallback: provider list may be unavailable during startup or profile sync.
  // Treat `<name>_{provider}_{model}` as translated output when provider/model tokens
  // look like mainstream API identifiers.
  const fallbackMatch = baseName.match(/_([^_]+)_(.+)$/);
  if (fallbackMatch) {
    const providerToken = normalizeSuffixToken(fallbackMatch[1]);
    const modelToken = normalizeSuffixToken(fallbackMatch[2]);
    const providerLooksKnown = providerHints.some((hint) =>
      providerToken.includes(hint),
    );
    const modelLooksLikeLlm =
      /\d/.test(modelToken) ||
      /(gpt|claude|gemini|deepseek|qwen|glm|llama|mistral|yi|sonnet|opus|haiku|command|ernie|kimi|doubao)/i.test(
        modelToken,
      );
    if (providerLooksKnown && modelLooksLikeLlm) return true;
  }
  return false;
};
