const toFiniteNumber = (value: unknown, fallback = 0): number => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

export const formatProgressCount = (
  current: unknown,
  total: unknown,
): string => {
  const safeCurrent = Math.max(0, Math.floor(toFiniteNumber(current, 0)));
  const safeTotal = Math.max(0, Math.floor(toFiniteNumber(total, 0)));
  return `${safeCurrent.toLocaleString()} / ${safeTotal.toLocaleString()}`;
};

export const formatProgressPercent = (percent: unknown): string => {
  const safePercent = toFiniteNumber(percent, 0);
  return `${safePercent.toFixed(1)}%`;
};

