export type V2HistoryStats = {
  totalRequests: number;
  totalRetries: number;
  totalErrors: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  errorStatusCodes?: Record<string, number>;
};

const toNonNegativeInt = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return null;
  return Math.trunc(value);
};

const normalizeErrorStatusCodes = (
  value: unknown,
): Record<string, number> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const normalized: Record<string, number> = {};
  for (const [code, count] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const parsed = toNonNegativeInt(count);
    if (parsed === null) continue;
    normalized[String(code)] = parsed;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const createEmptyV2HistoryStats = (): V2HistoryStats => ({
  totalRequests: 0,
  totalRetries: 0,
  totalErrors: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
});

export const applyProgressPayloadToV2HistoryStats = (
  stats: V2HistoryStats,
  payload: Record<string, unknown>,
): V2HistoryStats => {
  const totalRequests = toNonNegativeInt(payload.total_requests);
  const totalInputTokens = toNonNegativeInt(payload.total_input_tokens);
  const totalOutputTokens = toNonNegativeInt(payload.total_output_tokens);

  return {
    ...stats,
    ...(totalRequests !== null ? { totalRequests } : {}),
    ...(totalInputTokens !== null ? { totalInputTokens } : {}),
    ...(totalOutputTokens !== null ? { totalOutputTokens } : {}),
  };
};

export const applyRetryEventToV2HistoryStats = (
  stats: V2HistoryStats,
): V2HistoryStats => ({
  ...stats,
  totalRetries: Math.max(0, stats.totalRetries + 1),
});

export const applyFinalPayloadToV2HistoryStats = (
  stats: V2HistoryStats,
  payload: Record<string, unknown>,
): V2HistoryStats => {
  const totalRequests = toNonNegativeInt(payload.totalRequests);
  const totalRetries = toNonNegativeInt(payload.totalRetries);
  const totalErrors = toNonNegativeInt(payload.totalErrors);
  const totalInputTokens = toNonNegativeInt(payload.totalInputTokens);
  const totalOutputTokens = toNonNegativeInt(payload.totalOutputTokens);
  const errorStatusCodes = normalizeErrorStatusCodes(payload.errorStatusCodes);

  return {
    ...stats,
    ...(totalRequests !== null ? { totalRequests } : {}),
    ...(totalRetries !== null ? { totalRetries } : {}),
    ...(totalErrors !== null ? { totalErrors } : {}),
    ...(totalInputTokens !== null ? { totalInputTokens } : {}),
    ...(totalOutputTokens !== null ? { totalOutputTokens } : {}),
    ...(errorStatusCodes !== undefined ? { errorStatusCodes } : {}),
  };
};
