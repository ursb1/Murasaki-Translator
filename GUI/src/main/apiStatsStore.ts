import { ipcMain } from "electron";
import { createHash, randomUUID } from "crypto";
import { existsSync } from "fs";
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from "fs/promises";
import { join } from "path";

export type ApiStatsPhase =
  | "request_start"
  | "request_end"
  | "request_error"
  | "request_retry";

export type ApiStatsSource =
  | "translation_run"
  | "api_test"
  | "api_models"
  | "api_concurrency_test"
  | "sandbox_test"
  | "unknown";

export type ApiStatsInterval = "minute" | "hour" | "day";
export type ApiStatsTrendMetric =
  | "requests"
  | "latency"
  | "input_tokens"
  | "output_tokens"
  | "error_rate"
  | "success_rate";
export type ApiStatsBreakdownDimension =
  | "status_code"
  | "status_class"
  | "source"
  | "error_type"
  | "model"
  | "hour";

export type ApiStatsEventInput = {
  apiProfileId?: string;
  requestId?: string;
  phase?: string;
  ts?: string;
  source?: string;
  origin?: string;
  runId?: string;
  pipelineId?: string;
  endpointId?: string;
  endpointLabel?: string;
  model?: string;
  method?: string;
  path?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  retryAttempt?: number;
  errorType?: string;
  errorMessage?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  meta?: Record<string, unknown>;
};

export type ApiStatsEventRecord = {
  v: 1;
  eventId: string;
  apiProfileId: string;
  requestId: string;
  phase: ApiStatsPhase;
  ts: string;
  source: ApiStatsSource;
  origin: string;
  runId?: string;
  pipelineId?: string;
  endpointId?: string;
  endpointLabel?: string;
  model?: string;
  method?: string;
  path?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  retryAttempt?: number;
  errorType?: string;
  errorMessage?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  meta?: Record<string, unknown>;
};

type ApiStatsRollup = {
  version: 1;
  apiProfileId: string;
  updatedAt: string;
  totalEvents: number;
  totalRequests: number;
  phaseCounts: Record<string, number>;
  statusCounts: Record<string, number>;
  sourceCounts: Record<string, number>;
  errorTypeCounts: Record<string, number>;
  lastEventAt?: string;
};

type ApiStatsRequestRecord = {
  requestId: string;
  apiProfileId: string;
  startedAt: string;
  endedAt?: string;
  phaseFinal: "request_end" | "request_error" | "inflight";
  source: ApiStatsSource;
  origin: string;
  runId?: string;
  pipelineId?: string;
  endpointId?: string;
  endpointLabel?: string;
  model?: string;
  method?: string;
  path?: string;
  url?: string;
  statusCode?: number;
  durationMs?: number;
  inputTokens: number;
  outputTokens: number;
  retryCount: number;
  errorType?: string;
  errorMessage?: string;
  requestPayload?: unknown;
  responsePayload?: unknown;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
  meta?: Record<string, unknown>;
};

type ApiStatsRange = {
  fromTs?: string;
  toTs?: string;
};

type EventCacheEntry = {
  mtimeMs: number;
  size: number;
  events: ApiStatsEventRecord[];
};

const EVENT_VERSION = 1 as const;
const EVENTS_FILE_SUFFIX = ".stats.events.jsonl";
const ROLLUP_FILE_SUFFIX = ".stats.rollup.json";
const SAFE_PROFILE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
const SENSITIVE_KEY_RE =
  /(authorization|api[_-]?key|secret|password|(^|[_-])token($|[_-]))/i;
// Cap stored raw payload preview size to avoid oversized stats files.
const MAX_RAW_VALUE_CHARS = 100_000;
const MAX_EVENT_CACHE_ENTRIES = 64;

const fileWriteLocks = new Map<string, Promise<void>>();
const eventCache = new Map<string, EventCacheEntry>();

const touchEventCache = (eventsPath: string, entry: EventCacheEntry) => {
  if (eventCache.has(eventsPath)) {
    eventCache.delete(eventsPath);
  }
  eventCache.set(eventsPath, entry);
  while (eventCache.size > MAX_EVENT_CACHE_ENTRIES) {
    const oldestKey = eventCache.keys().next().value as string | undefined;
    if (!oldestKey) break;
    eventCache.delete(oldestKey);
  }
};

const withFileWriteLock = async <T>(
  target: string,
  task: () => Promise<T>,
): Promise<T> => {
  const previous = fileWriteLocks.get(target) || Promise.resolve();
  let releaseGate: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => gate);
  fileWriteLocks.set(target, tail);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    releaseGate?.();
    if (fileWriteLocks.get(target) === tail) {
      fileWriteLocks.delete(target);
    }
  }
};

const writeFileAtomic = async (target: string, content: string) => {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const tempPath = `${target}.tmp-${token}`;
  await writeFile(tempPath, content, "utf-8");
  try {
    await rename(tempPath, target);
  } catch {
    try {
      await writeFile(target, content, "utf-8");
    } finally {
      await unlink(tempPath).catch(() => null);
    }
  }
};

const coerceInt = (value: unknown): number | undefined => {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.trunc(n);
};

const coercePositiveInt = (value: unknown): number | undefined => {
  const n = coerceInt(value);
  if (n === undefined || n < 0) return undefined;
  return n;
};

const coerceString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const normalized = String(value).trim();
  return normalized || undefined;
};

const normalizeIsoTs = (value?: string): string => {
  if (!value) return new Date().toISOString();
  const parsed = Date.parse(value);
  if (Number.isFinite(parsed)) {
    return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
};

const parseTsMs = (value?: string): number => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeApiProfileId = (value: unknown, fallbackSeed = "unknown"): string => {
  const raw = String(value || "").trim();
  if (SAFE_PROFILE_ID_RE.test(raw)) return raw;
  const digest = createHash("sha1").update(`${raw}|${fallbackSeed}`).digest("hex");
  return `adhoc_${digest.slice(0, 12)}`;
};

const normalizePhase = (value: unknown): ApiStatsPhase | null => {
  const phase = String(value || "").trim().toLowerCase();
  if (
    phase === "request_start" ||
    phase === "request_end" ||
    phase === "request_error" ||
    phase === "request_retry"
  ) {
    return phase;
  }
  return null;
};

const normalizeSource = (value: unknown): ApiStatsSource => {
  const source = String(value || "").trim().toLowerCase();
  if (
    source === "translation_run" ||
    source === "api_test" ||
    source === "api_models" ||
    source === "api_concurrency_test" ||
    source === "sandbox_test"
  ) {
    return source;
  }
  return "unknown";
};

const sanitizeUnknown = (value: unknown): unknown => {
  const seen = new WeakSet<object>();
  const replacer = (key: string, currentValue: unknown) => {
    if (SENSITIVE_KEY_RE.test(key)) return "[REDACTED]";
    if (typeof currentValue === "bigint") return currentValue.toString();
    if (typeof currentValue === "object" && currentValue !== null) {
      if (seen.has(currentValue as object)) return "[Circular]";
      seen.add(currentValue as object);
    }
    return currentValue;
  };
  try {
    const json = JSON.stringify(value, replacer);
    if (json === undefined) return null;
    if (json.length > MAX_RAW_VALUE_CHARS) {
      return {
        truncated: true,
        rawLength: json.length,
        preview: json.slice(0, MAX_RAW_VALUE_CHARS),
      };
    }
    return JSON.parse(json);
  } catch {
    return coerceString(value) || "[Unserializable]";
  }
};

const sanitizeHeaders = (
  headers?: Record<string, string>,
): Record<string, string> | undefined => {
  if (!headers || typeof headers !== "object") return undefined;
  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    sanitized[String(key)] = SENSITIVE_KEY_RE.test(String(key))
      ? "[REDACTED]"
      : String(value);
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
};

const splitUrl = (
  rawPath: string | undefined,
  rawUrl: string | undefined,
): { path?: string; url?: string } => {
  const path = coerceString(rawPath);
  const url = coerceString(rawUrl);
  if (path || !url) return { path, url };
  try {
    const parsed = new URL(url);
    return {
      path: parsed.pathname || "/",
      url,
    };
  } catch {
    return { path: undefined, url };
  }
};

const normalizeEvent = (input: ApiStatsEventInput): ApiStatsEventRecord | null => {
  const phase = normalizePhase(input.phase);
  if (!phase) return null;
  const ts = normalizeIsoTs(input.ts);
  const source = normalizeSource(input.source);
  const origin = coerceString(input.origin) || "unknown";
  const { path, url } = splitUrl(
    coerceString(input.path),
    coerceString(input.url),
  );
  const fallbackSeed = `${url || ""}|${coerceString(input.model) || ""}|${source}`;
  const apiProfileId = normalizeApiProfileId(input.apiProfileId, fallbackSeed);
  const requestId =
    coerceString(input.requestId) ||
    `${apiProfileId}_${createHash("sha1")
      .update(`${ts}|${source}|${Math.random()}`)
      .digest("hex")
      .slice(0, 16)}`;

  return {
    v: EVENT_VERSION,
    eventId: randomUUID(),
    apiProfileId,
    requestId,
    phase,
    ts,
    source,
    origin,
    runId: coerceString(input.runId),
    pipelineId: coerceString(input.pipelineId),
    endpointId: coerceString(input.endpointId),
    endpointLabel: coerceString(input.endpointLabel),
    model: coerceString(input.model),
    method: coerceString(input.method)?.toUpperCase(),
    path,
    url,
    statusCode: coerceInt(input.statusCode),
    durationMs: coercePositiveInt(input.durationMs),
    inputTokens: coercePositiveInt(input.inputTokens),
    outputTokens: coercePositiveInt(input.outputTokens),
    retryAttempt: coercePositiveInt(input.retryAttempt),
    errorType: coerceString(input.errorType),
    errorMessage: coerceString(input.errorMessage),
    requestPayload: sanitizeUnknown(input.requestPayload),
    responsePayload: sanitizeUnknown(input.responsePayload),
    requestHeaders: sanitizeHeaders(input.requestHeaders),
    responseHeaders: sanitizeHeaders(input.responseHeaders),
    meta: sanitizeUnknown(input.meta) as Record<string, unknown> | undefined,
  };
};

const buildPaths = (profilesDir: string, apiProfileId: string) => {
  const safeId = normalizeApiProfileId(apiProfileId);
  const apiDir = join(profilesDir, "api");
  return {
    apiDir,
    eventsPath: join(apiDir, `${safeId}${EVENTS_FILE_SUFFIX}`),
    rollupPath: join(apiDir, `${safeId}${ROLLUP_FILE_SUFFIX}`),
  };
};

const loadEvents = async (eventsPath: string): Promise<ApiStatsEventRecord[]> => {
  if (!existsSync(eventsPath)) return [];
  const fileStat = await stat(eventsPath).catch(() => null);
  if (!fileStat) return [];
  const cached = eventCache.get(eventsPath);
  if (
    cached &&
    cached.mtimeMs === fileStat.mtimeMs &&
    cached.size === fileStat.size
  ) {
    touchEventCache(eventsPath, cached);
    return cached.events;
  }
  const raw = await readFile(eventsPath, "utf-8").catch(() => "");
  const events: ApiStatsEventRecord[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as ApiStatsEventRecord;
      if (!parsed || typeof parsed !== "object") continue;
      const normalized = normalizeEvent(parsed as ApiStatsEventInput);
      if (normalized) events.push(normalized);
    } catch {
      // ignore malformed line
    }
  }
  events.sort((a, b) => parseTsMs(a.ts) - parseTsMs(b.ts));
  touchEventCache(eventsPath, {
    mtimeMs: fileStat.mtimeMs,
    size: fileStat.size,
    events,
  });
  return events;
};

const inRange = (ts: string, range?: ApiStatsRange) => {
  const current = parseTsMs(ts);
  if (range?.fromTs) {
    const fromMs = parseTsMs(range.fromTs);
    if (current < fromMs) return false;
  }
  if (range?.toTs) {
    const toMs = parseTsMs(range.toTs);
    if (current > toMs) return false;
  }
  return true;
};

const clampPageSize = (value: number | undefined) => {
  if (!value || !Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(500, Math.trunc(value)));
};

const clampPage = (value: number | undefined) => {
  if (!value || !Number.isFinite(value)) return 1;
  return Math.max(1, Math.trunc(value));
};

const toBucketStart = (tsMs: number, interval: ApiStatsInterval): number => {
  const d = new Date(tsMs);
  if (interval === "day") {
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  }
  if (interval === "hour") {
    d.setUTCMinutes(0, 0, 0);
    return d.getTime();
  }
  d.setUTCSeconds(0, 0);
  return d.getTime();
};

const aggregateRequests = (events: ApiStatsEventRecord[]): ApiStatsRequestRecord[] => {
  const map = new Map<string, ApiStatsRequestRecord>();
  for (const event of events) {
    const existing = map.get(event.requestId);
    const startedAt = existing?.startedAt || event.ts;
    const base: ApiStatsRequestRecord = existing || {
      requestId: event.requestId,
      apiProfileId: event.apiProfileId,
      startedAt,
      phaseFinal: "inflight",
      source: event.source,
      origin: event.origin,
      runId: event.runId,
      pipelineId: event.pipelineId,
      endpointId: event.endpointId,
      endpointLabel: event.endpointLabel,
      model: event.model,
      method: event.method,
      path: event.path,
      url: event.url,
      statusCode: event.statusCode,
      durationMs: event.durationMs,
      inputTokens: event.inputTokens || 0,
      outputTokens: event.outputTokens || 0,
      retryCount: 0,
      errorType: event.errorType,
      errorMessage: event.errorMessage,
      requestPayload: event.requestPayload,
      responsePayload: event.responsePayload,
      requestHeaders: event.requestHeaders,
      responseHeaders: event.responseHeaders,
      meta: event.meta,
    };

    base.source = event.source || base.source;
    base.origin = event.origin || base.origin;
    base.runId = event.runId || base.runId;
    base.pipelineId = event.pipelineId || base.pipelineId;
    base.endpointId = event.endpointId || base.endpointId;
    base.endpointLabel = event.endpointLabel || base.endpointLabel;
    base.model = event.model || base.model;
    base.method = event.method || base.method;
    base.path = event.path || base.path;
    base.url = event.url || base.url;
    base.requestPayload = event.requestPayload ?? base.requestPayload;
    base.responsePayload = event.responsePayload ?? base.responsePayload;
    base.requestHeaders = event.requestHeaders ?? base.requestHeaders;
    base.responseHeaders = event.responseHeaders ?? base.responseHeaders;
    base.meta = event.meta ?? base.meta;

    if (event.phase === "request_start") {
      base.startedAt = event.ts || base.startedAt;
    } else if (event.phase === "request_end") {
      base.phaseFinal = "request_end";
      base.endedAt = event.ts || base.endedAt;
      base.statusCode = event.statusCode ?? base.statusCode;
      base.durationMs = event.durationMs ?? base.durationMs;
      base.inputTokens = event.inputTokens ?? base.inputTokens;
      base.outputTokens = event.outputTokens ?? base.outputTokens;
      base.errorType = undefined;
      base.errorMessage = undefined;
    } else if (event.phase === "request_error") {
      base.phaseFinal = "request_error";
      base.endedAt = event.ts || base.endedAt;
      base.statusCode = event.statusCode ?? base.statusCode;
      base.durationMs = event.durationMs ?? base.durationMs;
      base.errorType = event.errorType || base.errorType;
      base.errorMessage = event.errorMessage || base.errorMessage;
    } else if (event.phase === "request_retry") {
      base.retryCount += 1;
      if (event.retryAttempt && event.retryAttempt > base.retryCount) {
        base.retryCount = event.retryAttempt;
      }
      base.errorType = event.errorType || base.errorType;
      base.errorMessage = event.errorMessage || base.errorMessage;
    }

    map.set(event.requestId, base);
  }
  return Array.from(map.values()).sort(
    (a, b) => parseTsMs(b.startedAt) - parseTsMs(a.startedAt),
  );
};

const summarizeCounts = (pairs: Array<string | number | undefined>) => {
  const counts: Record<string, number> = {};
  for (const raw of pairs) {
    const key = String(raw ?? "unknown").trim() || "unknown";
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
};

const computePercentile = (values: number[], percentile: number): number => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1),
  );
  return sorted[rank] || 0;
};

const computeOverview = (
  requests: ApiStatsRequestRecord[],
  events: ApiStatsEventRecord[],
) => {
  const totalRequests = requests.length;
  const successRequests = requests.filter((item) => {
    const code = item.statusCode ?? 0;
    return item.phaseFinal === "request_end" && code >= 200 && code < 400;
  }).length;
  const failedRequests = requests.filter((item) => {
    const code = item.statusCode ?? 0;
    return item.phaseFinal === "request_error" || code >= 400;
  }).length;
  const inflightRequests = requests.filter(
    (item) => item.phaseFinal === "inflight",
  ).length;
  const retryCount = requests.reduce((sum, item) => sum + item.retryCount, 0);
  const totalInputTokens = requests.reduce(
    (sum, item) => sum + (item.inputTokens || 0),
    0,
  );
  const totalOutputTokens = requests.reduce(
    (sum, item) => sum + (item.outputTokens || 0),
    0,
  );
  const totalTokens = totalInputTokens + totalOutputTokens;
  const durationValues = requests
    .map((item) => item.durationMs || 0)
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgLatencyMs = durationValues.length
    ? Math.round(
        durationValues.reduce((sum, value) => sum + value, 0) /
          durationValues.length,
      )
    : 0;
  const p50LatencyMs = Math.round(computePercentile(durationValues, 50));
  const p95LatencyMs = Math.round(computePercentile(durationValues, 95));
  const fastestLatencyMs = durationValues.length
    ? Math.min(...durationValues)
    : 0;
  const slowestLatencyMs = durationValues.length
    ? Math.max(...durationValues)
    : 0;
  const totalDurationMs = durationValues.reduce((sum, value) => sum + value, 0);

  const startTimes = requests
    .map((item) => parseTsMs(item.startedAt))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  const firstRequestAt = startTimes.length
    ? new Date(startTimes[0]).toISOString()
    : undefined;
  const latestRequestAt = startTimes.length
    ? new Date(startTimes[startTimes.length - 1]).toISOString()
    : undefined;
  const observationWindowMs =
    startTimes.length >= 2
      ? Math.max(0, startTimes[startTimes.length - 1] - startTimes[0])
      : 0;
  const observationWindowMinutes = Number(
    (observationWindowMs / 60_000).toFixed(2),
  );
  let requestsPerMinuteAvg = 0;
  let peakRequestsPerMinute = 0;
  if (startTimes.length > 0) {
    const first = startTimes[0];
    const last = startTimes[startTimes.length - 1];
    const minutes = Math.max((last - first) / 60_000, 1);
    requestsPerMinuteAvg = Number((totalRequests / minutes).toFixed(2));
    const minuteCounts: Record<string, number> = {};
    for (const ts of startTimes) {
      const bucket = String(Math.floor(ts / 60_000));
      minuteCounts[bucket] = (minuteCounts[bucket] || 0) + 1;
    }
    peakRequestsPerMinute = Math.max(
      0,
      ...Object.values(minuteCounts).map((value) => Number(value)),
    );
  }

  const statusClassCounts = {
    "2xx": 0,
    "4xx": 0,
    "5xx": 0,
    other: 0,
    unknown: 0,
  };
  for (const item of requests) {
    const code = item.statusCode;
    if (typeof code !== "number") {
      statusClassCounts.unknown += 1;
      continue;
    }
    if (code >= 200 && code < 300) {
      statusClassCounts["2xx"] += 1;
      continue;
    }
    if (code >= 400 && code < 500) {
      statusClassCounts["4xx"] += 1;
      continue;
    }
    if (code >= 500 && code < 600) {
      statusClassCounts["5xx"] += 1;
      continue;
    }
    statusClassCounts.other += 1;
  }

  const statusCodeCounts = summarizeCounts(requests.map((item) => item.statusCode));
  const sourceCounts = summarizeCounts(requests.map((item) => item.source));
  const errorTypeCounts = summarizeCounts(
    requests
      .filter((item) => item.phaseFinal === "request_error")
      .map((item) => item.errorType || "unknown"),
  );
  const byHour = new Array(24).fill(0).map((_, hour) => ({ hour, count: 0 }));
  for (const item of requests) {
    const ms = parseTsMs(item.startedAt);
    if (!ms) continue;
    const hour = new Date(ms).getHours();
    if (hour >= 0 && hour < 24) byHour[hour].count += 1;
  }
  const successRate =
    totalRequests > 0
      ? Number(((successRequests / totalRequests) * 100).toFixed(2))
      : 0;
  const failureRate =
    totalRequests > 0
      ? Number(((failedRequests / totalRequests) * 100).toFixed(2))
      : 0;
  const avgRetriesPerRequest =
    totalRequests > 0 ? Number((retryCount / totalRequests).toFixed(2)) : 0;
  const outputInputRatio =
    totalInputTokens > 0
      ? Number((totalOutputTokens / totalInputTokens).toFixed(4))
      : 0;

  return {
    totalEvents: events.length,
    totalRequests,
    successRequests,
    failedRequests,
    inflightRequests,
    successRate,
    failureRate,
    totalRetries: retryCount,
    avgRetriesPerRequest,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    outputInputRatio,
    avgLatencyMs,
    p50LatencyMs,
    p95LatencyMs,
    fastestLatencyMs,
    slowestLatencyMs,
    totalDurationMs,
    requestsPerMinuteAvg,
    peakRequestsPerMinute,
    status2xx: statusClassCounts["2xx"],
    status4xx: statusClassCounts["4xx"],
    status5xx: statusClassCounts["5xx"],
    statusOther: statusClassCounts.other,
    statusUnknown: statusClassCounts.unknown,
    statusCodeCounts,
    sourceCounts,
    errorTypeCounts,
    byHour,
    firstRequestAt,
    latestRequestAt,
    observationWindowMs,
    observationWindowMinutes,
  };
};

const computeTrend = (
  requests: ApiStatsRequestRecord[],
  metric: ApiStatsTrendMetric,
  interval: ApiStatsInterval,
) => {
  const buckets = new Map<
    number,
    {
      requests: number;
      latencySum: number;
      latencyCount: number;
      inputTokens: number;
      outputTokens: number;
      errors: number;
    }
  >();

  for (const request of requests) {
    const tsMs = parseTsMs(request.startedAt);
    if (!tsMs) continue;
    const bucketStart = toBucketStart(tsMs, interval);
    const item =
      buckets.get(bucketStart) ||
      {
        requests: 0,
        latencySum: 0,
        latencyCount: 0,
        inputTokens: 0,
        outputTokens: 0,
        errors: 0,
      };
    item.requests += 1;
    if (request.durationMs && request.durationMs > 0) {
      item.latencySum += request.durationMs;
      item.latencyCount += 1;
    }
    item.inputTokens += request.inputTokens || 0;
    item.outputTokens += request.outputTokens || 0;
    if (request.phaseFinal === "request_error" || (request.statusCode || 0) >= 400) {
      item.errors += 1;
    }
    buckets.set(bucketStart, item);
  }

  return Array.from(buckets.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([bucketStart, item]) => {
      let value = item.requests;
      if (metric === "latency") {
        value = item.latencyCount > 0 ? item.latencySum / item.latencyCount : 0;
      } else if (metric === "input_tokens") {
        value = item.inputTokens;
      } else if (metric === "output_tokens") {
        value = item.outputTokens;
      } else if (metric === "error_rate") {
        value = item.requests > 0 ? (item.errors / item.requests) * 100 : 0;
      } else if (metric === "success_rate") {
        value =
          item.requests > 0
            ? ((item.requests - item.errors) / item.requests) * 100
            : 0;
      }
      return {
        bucketStart: new Date(bucketStart).toISOString(),
        value: Number(
          value.toFixed(
            metric === "latency" ||
              metric === "error_rate" ||
              metric === "success_rate"
              ? 2
              : 0,
          ),
        ),
        requests: item.requests,
        errors: item.errors,
        inputTokens: item.inputTokens,
        outputTokens: item.outputTokens,
      };
    });
};

const computeBreakdown = (
  requests: ApiStatsRequestRecord[],
  dimension: ApiStatsBreakdownDimension,
) => {
  const counts: Record<string, number> = {};
  for (const request of requests) {
    let key = "unknown";
    if (dimension === "status_code") {
      key = String(request.statusCode ?? "unknown");
    } else if (dimension === "status_class") {
      const code = request.statusCode;
      if (typeof code !== "number") {
        key = "unknown";
      } else if (code >= 200 && code < 300) {
        key = "2xx";
      } else if (code >= 400 && code < 500) {
        key = "4xx";
      } else if (code >= 500 && code < 600) {
        key = "5xx";
      } else {
        key = "other";
      }
    } else if (dimension === "source") {
      key = request.source || "unknown";
    } else if (dimension === "error_type") {
      key =
        request.phaseFinal === "request_error"
          ? request.errorType || "unknown"
          : "none";
    } else if (dimension === "model") {
      key = request.model || "unknown";
    } else if (dimension === "hour") {
      const ms = parseTsMs(request.startedAt);
      key = ms ? String(new Date(ms).getHours()).padStart(2, "0") : "unknown";
    }
    counts[key] = (counts[key] || 0) + 1;
  }

  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  return Object.entries(counts)
    .map(([key, count]) => ({
      key,
      count,
      ratio: total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count);
};

const buildRollup = (
  apiProfileId: string,
  events: ApiStatsEventRecord[],
  requests: ApiStatsRequestRecord[],
): ApiStatsRollup => ({
  version: 1,
  apiProfileId,
  updatedAt: new Date().toISOString(),
  totalEvents: events.length,
  totalRequests: requests.length,
  phaseCounts: summarizeCounts(events.map((item) => item.phase)),
  statusCounts: summarizeCounts(requests.map((item) => item.statusCode)),
  sourceCounts: summarizeCounts(requests.map((item) => item.source)),
  errorTypeCounts: summarizeCounts(
    requests
      .filter((item) => item.phaseFinal === "request_error")
      .map((item) => item.errorType || "unknown"),
  ),
  lastEventAt: events.length ? events[events.length - 1].ts : undefined,
});

const safeJson = (value: unknown) => JSON.stringify(value, null, 2);

export const createApiStatsService = (deps: {
  getProfilesDir: () => string;
}) => {
  const appendEvent = async (input: ApiStatsEventInput) => {
    const normalized = normalizeEvent(input);
    if (!normalized) return;
    const profilesDir = deps.getProfilesDir();
    const { apiDir, eventsPath } = buildPaths(profilesDir, normalized.apiProfileId);
    await mkdir(apiDir, { recursive: true });
    await withFileWriteLock(eventsPath, async () => {
      await appendFile(
        eventsPath,
        `${JSON.stringify(normalized, null, 0)}\n`,
        "utf-8",
      );
    });
    eventCache.delete(eventsPath);
  };

  const loadRequests = async (
    apiProfileId: string,
    range?: ApiStatsRange,
  ): Promise<{ events: ApiStatsEventRecord[]; requests: ApiStatsRequestRecord[] }> => {
    const profilesDir = deps.getProfilesDir();
    const { eventsPath } = buildPaths(profilesDir, apiProfileId);
    const events = await loadEvents(eventsPath);
    const rangedEvents = range
      ? events.filter((item) => inRange(item.ts, range))
      : events;
    const requests = aggregateRequests(rangedEvents);
    return { events: rangedEvents, requests };
  };

  const writeRollupSnapshot = async (
    apiProfileId: string,
    events: ApiStatsEventRecord[],
    requests: ApiStatsRequestRecord[],
  ) => {
    const profilesDir = deps.getProfilesDir();
    const { apiDir, rollupPath } = buildPaths(profilesDir, apiProfileId);
    await mkdir(apiDir, { recursive: true });
    const rollup = buildRollup(apiProfileId, events, requests);
    await withFileWriteLock(rollupPath, async () => {
      await writeFileAtomic(rollupPath, safeJson(rollup));
    });
  };

  const queryOverview = async (payload: {
    apiProfileId?: string;
    fromTs?: string;
    toTs?: string;
  }) => {
    const apiProfileId = normalizeApiProfileId(payload.apiProfileId);
    const range: ApiStatsRange = {
      fromTs: payload.fromTs,
      toTs: payload.toTs,
    };
    const { events, requests } = await loadRequests(apiProfileId, range);
    const overview = computeOverview(requests, events);
    await writeRollupSnapshot(apiProfileId, events, requests).catch(() => null);
    return {
      apiProfileId,
      range,
      ...overview,
    };
  };

  const queryTrend = async (payload: {
    apiProfileId?: string;
    metric?: ApiStatsTrendMetric;
    interval?: ApiStatsInterval;
    fromTs?: string;
    toTs?: string;
  }) => {
    const apiProfileId = normalizeApiProfileId(payload.apiProfileId);
    const range: ApiStatsRange = {
      fromTs: payload.fromTs,
      toTs: payload.toTs,
    };
    const metric: ApiStatsTrendMetric =
      payload.metric === "latency" ||
      payload.metric === "input_tokens" ||
      payload.metric === "output_tokens" ||
      payload.metric === "error_rate" ||
      payload.metric === "success_rate"
        ? payload.metric
        : "requests";
    const interval: ApiStatsInterval =
      payload.interval === "minute" || payload.interval === "day"
        ? payload.interval
        : "hour";
    const { requests } = await loadRequests(apiProfileId, range);
    return {
      apiProfileId,
      range,
      metric,
      interval,
      points: computeTrend(requests, metric, interval),
    };
  };

  const queryBreakdown = async (payload: {
    apiProfileId?: string;
    dimension?: ApiStatsBreakdownDimension;
    fromTs?: string;
    toTs?: string;
  }) => {
    const apiProfileId = normalizeApiProfileId(payload.apiProfileId);
    const dimension: ApiStatsBreakdownDimension =
      payload.dimension === "status_class" ||
      payload.dimension === "source" ||
      payload.dimension === "error_type" ||
      payload.dimension === "model" ||
      payload.dimension === "hour"
        ? payload.dimension
        : "status_code";
    const range: ApiStatsRange = {
      fromTs: payload.fromTs,
      toTs: payload.toTs,
    };
    const { requests } = await loadRequests(apiProfileId, range);
    return {
      apiProfileId,
      range,
      dimension,
      items: computeBreakdown(requests, dimension),
    };
  };

  const queryRecords = async (payload: {
    apiProfileId?: string;
    fromTs?: string;
    toTs?: string;
    page?: number;
    pageSize?: number;
    statusCode?: number;
    source?: string;
    phase?: "request_end" | "request_error" | "inflight";
    query?: string;
  }) => {
    const apiProfileId = normalizeApiProfileId(payload.apiProfileId);
    const range: ApiStatsRange = {
      fromTs: payload.fromTs,
      toTs: payload.toTs,
    };
    const { requests } = await loadRequests(apiProfileId, range);
    const statusFilter = coerceInt(payload.statusCode);
    const sourceFilter = coerceString(payload.source);
    const phaseFilter = coerceString(payload.phase) as
      | "request_end"
      | "request_error"
      | "inflight"
      | undefined;
    const keyword = (coerceString(payload.query) || "").toLowerCase();
    const filtered = requests.filter((item) => {
      if (statusFilter !== undefined && (item.statusCode ?? -1) !== statusFilter) {
        return false;
      }
      if (sourceFilter && item.source !== sourceFilter) {
        return false;
      }
      if (phaseFilter && item.phaseFinal !== phaseFilter) {
        return false;
      }
      if (!keyword) return true;
      const haystack = [
        item.requestId,
        item.runId,
        item.pipelineId,
        item.model,
        item.method,
        item.path,
        item.url,
        item.errorType,
        item.errorMessage,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });

    const page = clampPage(payload.page);
    const pageSize = clampPageSize(payload.pageSize);
    const start = (page - 1) * pageSize;
    const end = start + pageSize;

    return {
      apiProfileId,
      range,
      page,
      pageSize,
      total: filtered.length,
      items: filtered.slice(start, end),
    };
  };

  const clearRecords = async (payload: { apiProfileId?: string; beforeTs?: string }) => {
    const apiProfileId = normalizeApiProfileId(payload.apiProfileId);
    const profilesDir = deps.getProfilesDir();
    const { eventsPath, rollupPath } = buildPaths(profilesDir, apiProfileId);
    if (!existsSync(eventsPath)) {
      return { apiProfileId, deleted: 0, kept: 0 };
    }
    const events = await loadEvents(eventsPath);
    const beforeMs = payload.beforeTs ? parseTsMs(payload.beforeTs) : 0;
    if (!beforeMs) {
      await withFileWriteLock(eventsPath, async () => {
        await unlink(eventsPath).catch(() => null);
      });
      await withFileWriteLock(rollupPath, async () => {
        await unlink(rollupPath).catch(() => null);
      });
      eventCache.delete(eventsPath);
      return { apiProfileId, deleted: events.length, kept: 0 };
    }
    const kept = events.filter((item) => parseTsMs(item.ts) >= beforeMs);
    const deleted = events.length - kept.length;
    await withFileWriteLock(eventsPath, async () => {
      if (!kept.length) {
        await unlink(eventsPath).catch(() => null);
      } else {
        const content = kept.map((item) => JSON.stringify(item)).join("\n") + "\n";
        await writeFileAtomic(eventsPath, content);
      }
    });
    eventCache.delete(eventsPath);
    if (!kept.length) {
      await withFileWriteLock(rollupPath, async () => {
        await unlink(rollupPath).catch(() => null);
      });
    } else {
      const requests = aggregateRequests(kept);
      await writeRollupSnapshot(apiProfileId, kept, requests).catch(() => null);
    }
    return { apiProfileId, deleted, kept: kept.length };
  };

  const wrap = async <T>(task: () => Promise<T>) => {
    try {
      const data = await task();
      return { ok: true as const, data };
    } catch (error: unknown) {
      return {
        ok: false as const,
        error:
          error instanceof Error ? error.message : String(error || "unknown_error"),
      };
    }
  };

  const registerIpc = () => {
    ipcMain.handle("api-stats-overview", async (_event, payload) =>
      wrap(() => queryOverview(payload || {})),
    );
    ipcMain.handle("api-stats-trend", async (_event, payload) =>
      wrap(() => queryTrend(payload || {})),
    );
    ipcMain.handle("api-stats-breakdown", async (_event, payload) =>
      wrap(() => queryBreakdown(payload || {})),
    );
    ipcMain.handle("api-stats-records", async (_event, payload) =>
      wrap(() => queryRecords(payload || {})),
    );
    ipcMain.handle("api-stats-clear", async (_event, payload) =>
      wrap(() => clearRecords(payload || {})),
    );
  };

  return {
    appendEvent,
    registerIpc,
  };
};

export const __testOnly = {
  normalizeEvent,
  aggregateRequests,
  computeOverview,
  computeTrend,
  computeBreakdown,
  normalizeApiProfileId,
  normalizePhase,
  buildPaths,
  loadEvents,
  getEventCacheSize: () => eventCache.size,
  getEventCacheLimit: () => MAX_EVENT_CACHE_ENTRIES,
  clearEventCache: () => eventCache.clear(),
};
