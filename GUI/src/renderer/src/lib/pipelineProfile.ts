export type PipelineSummary = {
  id: string;
  name: string;
  provider: string;
  prompt: string;
  parser: string;
  linePolicy: string;
  chunkPolicy: string;
};

const toSafeString = (value: unknown) =>
  value === undefined || value === null ? "" : String(value);

export const buildPipelineSummary = (
  data: unknown,
  fallback?: { id?: string; name?: string },
): PipelineSummary => {
  const raw =
    data && typeof data === "object" ? (data as Record<string, unknown>) : {};

  return {
    id: toSafeString(raw.id ?? fallback?.id ?? ""),
    name: toSafeString(raw.name ?? fallback?.name ?? ""),
    provider: toSafeString(raw.provider ?? ""),
    prompt: toSafeString(raw.prompt ?? ""),
    parser: toSafeString(raw.parser ?? ""),
    linePolicy: toSafeString(raw.line_policy ?? raw.linePolicy ?? ""),
    chunkPolicy: toSafeString(raw.chunk_policy ?? raw.chunkPolicy ?? ""),
  };
};
