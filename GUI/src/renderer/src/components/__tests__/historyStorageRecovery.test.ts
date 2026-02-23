import { beforeEach, describe, expect, it } from "vitest";
import type { TranslationRecord } from "../HistoryView";
import { clearHistory, getHistory, saveHistory } from "../HistoryView";

const HISTORY_STORAGE_KEY = "translation_history";
const HISTORY_BACKUP_STORAGE_KEY = "translation_history_backup";

const createStorageMock = () => {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
};

const createRecord = (id: string): TranslationRecord => ({
  id,
  fileName: `${id}.txt`,
  filePath: `E:/input/${id}.txt`,
  startTime: "2026-02-23T00:00:00.000Z",
  status: "completed",
  totalBlocks: 1,
  completedBlocks: 1,
  totalLines: 1,
  triggers: [
    {
      time: "2026-02-23T00:00:01.000Z",
      type: "warning_quality",
      block: 1,
      message: "warn",
    },
  ],
  logs: ["log-line"],
});

describe("history storage recovery", () => {
  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage =
      createStorageMock() as unknown as Storage;
  });

  it("persists lightweight history to both primary and backup keys", () => {
    const record = createRecord("r1");
    saveHistory([record]);

    const primaryRaw = localStorage.getItem(HISTORY_STORAGE_KEY);
    const backupRaw = localStorage.getItem(HISTORY_BACKUP_STORAGE_KEY);
    expect(primaryRaw).toBeTruthy();
    expect(backupRaw).toBe(primaryRaw);

    const parsed = JSON.parse(primaryRaw || "[]");
    expect(parsed[0].logs).toEqual([]);
    expect(parsed[0].triggers).toEqual([]);
  });

  it("recovers from backup when primary history payload is malformed", () => {
    const backup = [createRecord("r2")].map((record) => ({
      ...record,
      logs: [],
      triggers: [],
    }));
    localStorage.setItem(HISTORY_STORAGE_KEY, "{");
    localStorage.setItem(HISTORY_BACKUP_STORAGE_KEY, JSON.stringify(backup));

    const history = getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].id).toBe("r2");
    expect(history[0].logs).toEqual([]);
    expect(history[0].triggers).toEqual([]);
  });

  it("clears corrupted primary payload when no backup is available", () => {
    localStorage.setItem(HISTORY_STORAGE_KEY, "{");
    localStorage.removeItem(HISTORY_BACKUP_STORAGE_KEY);

    const history = getHistory();
    expect(history).toEqual([]);
    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });

  it("clearHistory removes both primary and backup history keys", () => {
    saveHistory([createRecord("r3")]);
    clearHistory();

    expect(localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(HISTORY_BACKUP_STORAGE_KEY)).toBeNull();
  });
});
