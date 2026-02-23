import { describe, expect, it } from "vitest";

import type { QueueItem } from "../../types/common";
import {
  LEGACY_FILE_QUEUE_KEY,
  LIBRARY_QUEUE_KEY,
  loadLibraryQueueFromStorage,
  persistLibraryQueueToStorage,
  type StorageLike,
} from "../libraryQueueStorage";

const createMemoryStorage = (
  initial: Record<string, string> = {},
): StorageLike & { snapshot: () => Record<string, string> } => {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    snapshot: () => Object.fromEntries(store.entries()),
  };
};

const buildQueueItem = (path: string): QueueItem => ({
  id: `id-${path}`,
  path,
  fileName: path.split(/[/\\]/).pop() || path,
  fileType: "txt",
  addedAt: "2026-02-23T00:00:00.000Z",
  status: "pending",
  config: { useGlobalDefaults: true },
});

describe("libraryQueueStorage", () => {
  it("migrates legacy file_queue to library_queue and removes legacy key", () => {
    const storage = createMemoryStorage({
      [LEGACY_FILE_QUEUE_KEY]: JSON.stringify([
        "C:/a.txt",
        "C:/a.txt",
        "C:/b.txt",
      ]),
    });

    const queue = loadLibraryQueueFromStorage(storage, buildQueueItem);

    expect(queue.map((item) => item.path)).toEqual(["C:/a.txt", "C:/b.txt"]);
    expect(storage.getItem(LEGACY_FILE_QUEUE_KEY)).toBeNull();
    expect(storage.getItem(LIBRARY_QUEUE_KEY)).not.toBeNull();
  });

  it("prefers library_queue and clears stale legacy key", () => {
    const existingQueue: QueueItem[] = [buildQueueItem("D:/new.txt")];
    const storage = createMemoryStorage({
      [LIBRARY_QUEUE_KEY]: JSON.stringify(existingQueue),
      [LEGACY_FILE_QUEUE_KEY]: JSON.stringify(["D:/old.txt"]),
    });

    const queue = loadLibraryQueueFromStorage(storage, buildQueueItem);

    expect(queue).toEqual(existingQueue);
    expect(storage.getItem(LEGACY_FILE_QUEUE_KEY)).toBeNull();
  });

  it("accepts legacy string-array payload in library_queue and normalizes it", () => {
    const storage = createMemoryStorage({
      [LIBRARY_QUEUE_KEY]: JSON.stringify(["E:/legacy.txt"]),
    });

    const queue = loadLibraryQueueFromStorage(storage, buildQueueItem);

    expect(queue.map((item) => item.path)).toEqual(["E:/legacy.txt"]);
    const persisted = JSON.parse(storage.getItem(LIBRARY_QUEUE_KEY) || "[]");
    expect(Array.isArray(persisted)).toBe(true);
    expect(persisted[0].path).toBe("E:/legacy.txt");
  });

  it("falls back to legacy key when library_queue payload is malformed", () => {
    const storage = createMemoryStorage({
      [LIBRARY_QUEUE_KEY]: "{",
      [LEGACY_FILE_QUEUE_KEY]: JSON.stringify(["F:/from-legacy.txt"]),
    });

    const queue = loadLibraryQueueFromStorage(storage, buildQueueItem);

    expect(queue.map((item) => item.path)).toEqual(["F:/from-legacy.txt"]);
    expect(storage.getItem(LEGACY_FILE_QUEUE_KEY)).toBeNull();
  });

  it("persists queue to library_queue only and drops legacy key", () => {
    const storage = createMemoryStorage({
      [LEGACY_FILE_QUEUE_KEY]: JSON.stringify(["G:/legacy.txt"]),
    });
    const queue = [buildQueueItem("G:/new.txt")];

    persistLibraryQueueToStorage(storage, queue);

    expect(storage.getItem(LEGACY_FILE_QUEUE_KEY)).toBeNull();
    expect(JSON.parse(storage.getItem(LIBRARY_QUEUE_KEY) || "[]")).toEqual(
      queue,
    );
    expect(storage.snapshot()).toHaveProperty(LIBRARY_QUEUE_KEY);
  });
});
