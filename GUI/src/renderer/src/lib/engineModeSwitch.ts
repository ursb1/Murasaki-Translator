const ENGINE_MODE_TOGGLE_IGNORE_SELECTOR =
  "select, option, input, textarea, [data-engine-switch-ignore='true']";

export type EngineMode = "v1" | "v2";

type QueueConfigLike = {
  useGlobalDefaults?: boolean;
  engineMode?: EngineMode;
};

type QueueItemLike = {
  config?: QueueConfigLike;
} | null | undefined;

type ClosestCapableTarget = EventTarget & {
  closest: (selectors: string) => unknown;
};

const hasClosest = (
  target: EventTarget | null,
): target is ClosestCapableTarget =>
  typeof target === "object" &&
  target !== null &&
  "closest" in target &&
  typeof (target as { closest?: unknown }).closest === "function";

export const shouldIgnoreEngineModeToggle = (
  target: EventTarget | null,
): boolean => {
  if (!hasClosest(target)) return false;
  return Boolean(target.closest(ENGINE_MODE_TOGGLE_IGNORE_SELECTOR));
};

export const resolveQueueItemEngineMode = (
  queueItem: QueueItemLike,
  globalEngineMode: EngineMode,
): EngineMode => {
  const config = queueItem?.config;
  if (!config || config.useGlobalDefaults !== false) {
    return globalEngineMode;
  }
  return config.engineMode === "v1" || config.engineMode === "v2"
    ? config.engineMode
    : globalEngineMode;
};
