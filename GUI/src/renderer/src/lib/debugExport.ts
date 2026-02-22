const REDACTED_VALUE = "[REDACTED]";
const V2_STORAGE_PREFIX = "murasaki.v2.";

export const V2_PROFILE_KINDS = [
  "api",
  "pipeline",
  "prompt",
  "parser",
  "policy",
  "chunk",
] as const;

export type V2ProfileKind = (typeof V2_PROFILE_KINDS)[number];

type ProfileSummary = {
  id?: unknown;
  name?: unknown;
};

type ProfileLoadResult = {
  id?: unknown;
  name?: unknown;
  data?: unknown;
} | null;

type ProfileLoadBatchEntry = {
  id?: unknown;
  result?: ProfileLoadResult;
};

export interface DebugExportApi {
  pipelineV2ProfilesList?: (
    kind: string,
    options?: { preferLocal?: boolean },
  ) => Promise<ProfileSummary[]>;
  pipelineV2ProfilesLoadBatch?: (
    kind: string,
    ids: string[],
  ) => Promise<ProfileLoadBatchEntry[]>;
  pipelineV2ProfilesLoad?: (
    kind: string,
    id: string,
  ) => Promise<ProfileLoadResult>;
}

export interface V2DebugProfileRecord {
  id: string;
  name: string;
  data: unknown;
}

export interface V2DebugSnapshot {
  storage: Record<string, unknown>;
  profiles: Record<V2ProfileKind, V2DebugProfileRecord[]>;
  errors: Record<string, string>;
}

const normalizeKey = (key: string) =>
  key.replace(/[^a-z0-9]/gi, "").toLowerCase();

const toErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const isStandaloneUrl = (value: string) =>
  /^(https?|wss?):\/\/\S+$/i.test(value);

const isBearerSecret = (value: string) =>
  /^bearer\s+[A-Za-z0-9._~+/=-]+$/i.test(value.trim());

const redactInlineSecrets = (value: string) => {
  let next = value;
  next = next.replace(
    /((?:api[_-]?keys?|apikey)\s*[:=]\s*)(["']?)([^"'`\r\n]+)\2/gi,
    "$1[REDACTED]",
  );
  next = next.replace(
    /((?:base[_-]?url|baseurl|url)\s*[:=]\s*)(["']?)([^"'`\r\n]+)\2/gi,
    "$1[REDACTED]",
  );
  next = next.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
  return next;
};

export const isSensitiveDebugKey = (key: string) => {
  const normalized = normalizeKey(key);
  return (
    normalized.includes("apikey") ||
    normalized.includes("baseurl") ||
    normalized === "url" ||
    normalized.endsWith("url")
  );
};

export const redactSensitiveDebugValue = (
  value: unknown,
  keyHint = "",
): unknown => {
  if (isSensitiveDebugKey(keyHint)) return REDACTED_VALUE;
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (isStandaloneUrl(trimmed) || isBearerSecret(trimmed)) {
      return REDACTED_VALUE;
    }
    return redactInlineSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveDebugValue(item, keyHint));
  }

  if (typeof value === "object") {
    const next: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      next[key] = redactSensitiveDebugValue(child, key);
    });
    return next;
  }

  return value;
};

export const redactSensitiveConfigData = (
  configData: Record<string, string | null>,
) => {
  const next: Record<string, string | null> = {};
  Object.entries(configData).forEach(([key, value]) => {
    const sanitized = redactSensitiveDebugValue(value, key);
    if (sanitized === null || sanitized === undefined) {
      next[key] = null;
      return;
    }
    next[key] = typeof sanitized === "string" ? sanitized : String(sanitized);
  });
  return next;
};

const parseMaybeJson = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

export const collectV2StorageDebug = (storage: Storage) => {
  const data: Record<string, unknown> = {};
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key || !key.startsWith(V2_STORAGE_PREFIX)) continue;
    const raw = storage.getItem(key);
    if (raw === null) continue;
    data[key] = redactSensitiveDebugValue(parseMaybeJson(raw), key);
  }
  return data;
};

const normalizeProfileSummaries = (
  items: unknown,
): Array<{
  id: string;
  name: string;
}> => {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const id = String((item as ProfileSummary).id || "").trim();
      if (!id) return null;
      const nameRaw = String((item as ProfileSummary).name || "").trim();
      return { id, name: nameRaw || id };
    })
    .filter((item): item is { id: string; name: string } => Boolean(item));
};

const loadProfilesByKind = async (
  api: DebugExportApi,
  kind: V2ProfileKind,
  ids: string[],
) => {
  const loadedMap = new Map<string, ProfileLoadResult>();

  if (api.pipelineV2ProfilesLoadBatch) {
    try {
      const batch = await api.pipelineV2ProfilesLoadBatch(kind, ids);
      if (Array.isArray(batch)) {
        batch.forEach((entry) => {
          const id = String(entry?.id || "").trim();
          if (!id) return;
          loadedMap.set(id, entry?.result ?? null);
        });
      }
    } catch {
      // Fall back to single profile loads below.
    }
  }

  const missingIds = ids.filter((id) => !loadedMap.has(id));
  if (!missingIds.length || !api.pipelineV2ProfilesLoad) return loadedMap;
  const loadSingle = api.pipelineV2ProfilesLoad;

  const results = await Promise.all(
    missingIds.map(async (id) => {
      try {
        return { id, result: await loadSingle(kind, id) };
      } catch {
        return { id, result: null };
      }
    }),
  );
  results.forEach(({ id, result }) => loadedMap.set(id, result));
  return loadedMap;
};

export const buildV2DebugSnapshot = async (
  api: DebugExportApi | undefined,
  storage: Storage,
): Promise<V2DebugSnapshot> => {
  const snapshot: V2DebugSnapshot = {
    storage: collectV2StorageDebug(storage),
    profiles: {
      api: [],
      pipeline: [],
      prompt: [],
      parser: [],
      policy: [],
      chunk: [],
    },
    errors: {},
  };

  if (!api?.pipelineV2ProfilesList) {
    snapshot.errors.profiles = "pipelineV2ProfilesList_not_available";
    return snapshot;
  }

  for (const kind of V2_PROFILE_KINDS) {
    let list: Array<{ id: string; name: string }> = [];
    try {
      const listed = await api.pipelineV2ProfilesList(kind, {
        preferLocal: true,
      });
      list = normalizeProfileSummaries(listed);
    } catch (error) {
      snapshot.errors[`list:${kind}`] = toErrorMessage(error);
      continue;
    }

    if (!list.length) continue;

    let loadedMap = new Map<string, ProfileLoadResult>();
    try {
      loadedMap = await loadProfilesByKind(
        api,
        kind,
        list.map((item) => item.id),
      );
    } catch (error) {
      snapshot.errors[`load:${kind}`] = toErrorMessage(error);
    }

    snapshot.profiles[kind] = list.map((item) => {
      const loaded = loadedMap.get(item.id);
      const loadedName =
        loaded && typeof loaded === "object"
          ? String((loaded as { name?: unknown }).name || "").trim()
          : "";
      const loadedData =
        loaded && typeof loaded === "object"
          ? (loaded as { data?: unknown }).data
          : null;
      return {
        id: item.id,
        name: loadedName || item.name,
        data: redactSensitiveDebugValue(loadedData ?? {}, ""),
      };
    });
  }

  return snapshot;
};
