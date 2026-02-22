const ENGINE_MODE_TOGGLE_IGNORE_SELECTOR =
  "select, option, input, textarea, [data-engine-switch-ignore='true']";

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
