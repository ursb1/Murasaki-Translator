import type { QueueItem } from "../types/common";

export const LIBRARY_QUEUE_KEY = "library_queue";
export const LEGACY_FILE_QUEUE_KEY = "file_queue";

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

const parseJson = (raw: string | null): unknown => {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

const normalizeQueueItems = (value: unknown): QueueItem[] | null => {
  if (!Array.isArray(value)) return null;
  const validItems = value.filter(
    (item) =>
      item &&
      typeof item === "object" &&
      typeof (item as { path?: unknown }).path === "string",
  );
  if (validItems.length === 0 && value.length > 0) return null;
  return validItems as QueueItem[];
};

const normalizeLegacyPaths = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const paths: string[] = [];
  value.forEach((item) => {
    if (typeof item !== "string") return;
    const path = item.trim();
    if (!path || seen.has(path)) return;
    seen.add(path);
    paths.push(path);
  });
  return paths;
};

const migrateLegacyPaths = (
  storage: StorageLike,
  paths: string[],
  buildFromLegacyPath: (path: string) => QueueItem,
): QueueItem[] => {
  if (paths.length === 0) return [];
  const migratedQueue = paths.map(buildFromLegacyPath);
  try {
    storage.setItem(LIBRARY_QUEUE_KEY, JSON.stringify(migratedQueue));
    storage.removeItem(LEGACY_FILE_QUEUE_KEY);
  } catch {
    // ignore storage write failures and keep in-memory queue
  }
  return migratedQueue;
};

export const loadLibraryQueueFromStorage = (
  storage: StorageLike,
  buildFromLegacyPath: (path: string) => QueueItem,
): QueueItem[] => {
  const libraryPayload = parseJson(storage.getItem(LIBRARY_QUEUE_KEY));
  const queue = normalizeQueueItems(libraryPayload);
  if (queue) {
    try {
      storage.removeItem(LEGACY_FILE_QUEUE_KEY);
    } catch {
      // ignore cleanup failures
    }
    return queue;
  }

  const libraryAsLegacyPaths = normalizeLegacyPaths(libraryPayload);
  if (libraryAsLegacyPaths.length > 0) {
    return migrateLegacyPaths(
      storage,
      libraryAsLegacyPaths,
      buildFromLegacyPath,
    );
  }

  const legacyPayload = parseJson(storage.getItem(LEGACY_FILE_QUEUE_KEY));
  const legacyPaths = normalizeLegacyPaths(legacyPayload);
  return migrateLegacyPaths(storage, legacyPaths, buildFromLegacyPath);
};

export const loadLibraryQueueWithLegacyMigration = (
  buildFromLegacyPath: (path: string) => QueueItem,
): QueueItem[] => {
  if (typeof window === "undefined" || !window.localStorage) return [];
  return loadLibraryQueueFromStorage(window.localStorage, buildFromLegacyPath);
};

export const persistLibraryQueueToStorage = (
  storage: StorageLike,
  queue: QueueItem[],
): void => {
  try {
    storage.setItem(LIBRARY_QUEUE_KEY, JSON.stringify(queue));
    storage.removeItem(LEGACY_FILE_QUEUE_KEY);
  } catch {
    // ignore storage write failures
  }
};

export const persistLibraryQueue = (queue: QueueItem[]): void => {
  if (typeof window === "undefined" || !window.localStorage) return;
  persistLibraryQueueToStorage(window.localStorage, queue);
};
