import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Language, translations } from "../lib/i18n";
import type {
  RemoteApiResponse,
  RemoteDiagnostics,
  RemoteNetworkEvent,
  RemoteNetworkStatus,
  RemoteRuntimeStatus,
} from "../types/api";

const CACHE_KEY = "remote_runtime_cache_v1";
const POLL_INTERVAL_CONNECTED_MS = 3000;
const POLL_INTERVAL_IDLE_MS = 9000;
const REMOTE_RUNTIME_I18N_PREFIX = "i18n:remoteRuntime.";

type RemoteRuntimeText = (typeof translations)[Language]["remoteRuntime"];

const createDefaultRuntime = (notice: string): RemoteRuntimeStatus => ({
  connected: false,
  executionMode: "local",
  session: null,
  fileScope: "isolated-remote",
  outputPolicy: "scoped-remote-dir",
  notice,
  syncMirrorPath: "",
  networkEventLogPath: "",
});

const createDefaultNetwork = (notice: string): RemoteNetworkStatus => ({
  connected: false,
  executionMode: "local",
  session: null,
  fileScope: "isolated-remote",
  outputPolicy: "scoped-remote-dir",
  wsConnected: false,
  inFlightRequests: 0,
  totalEvents: 0,
  successCount: 0,
  errorCount: 0,
  retryCount: 0,
  uploadCount: 0,
  downloadCount: 0,
  notice,
  syncMirrorPath: "",
  networkEventLogPath: "",
});

const createDefaultDiagnostics = (notice: string): RemoteDiagnostics => ({
  executionMode: "local",
  connected: false,
  session: null,
  healthFailures: 0,
  activeTaskId: null,
  syncMirrorPath: "",
  networkEventLogPath: "",
  notice,
  network: createDefaultNetwork(notice),
});

const resolveRemoteRuntimeToken = (
  rawValue: unknown,
  remoteText: RemoteRuntimeText,
): string => {
  const value = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!value) return "";
  if (!value.startsWith(REMOTE_RUNTIME_I18N_PREFIX)) return value;

  const encoded = value.slice(REMOTE_RUNTIME_I18N_PREFIX.length);
  const [rawKey, rawArg = ""] = encoded.split("|", 2);
  const key = rawKey.trim() as keyof RemoteRuntimeText;
  const template = remoteText[key];
  if (typeof template !== "string" || !template.trim()) return value;
  if (!rawArg) return template;

  let argValue = rawArg;
  try {
    argValue = decodeURIComponent(rawArg);
  } catch {
    argValue = rawArg;
  }
  return template.includes("{message}")
    ? template.replace("{message}", argValue)
    : `${template} ${argValue}`.trim();
};

const resolveRemoteRuntimeHint = (
  rawHint: unknown,
  remoteText: RemoteRuntimeText,
): string => {
  const hint = typeof rawHint === "string" ? rawHint : "";
  if (!hint.trim()) return "";
  return hint
    .split(/\r?\n/)
    .map((item) => resolveRemoteRuntimeToken(item, remoteText))
    .map((item) => item.trim())
    .filter(Boolean)
    .join(" ");
};

interface RemoteErrorUi {
  title: string;
  description: string;
  hint?: string;
}

export interface UseRemoteRuntimeResult {
  runtime: RemoteRuntimeStatus;
  network: RemoteNetworkStatus;
  diagnostics: RemoteDiagnostics;
  networkEvents: RemoteNetworkEvent[];
  loading: boolean;
  refreshing: boolean;
  lastError: string | null;
  lastUpdatedAt: number | null;
  isRemoteMode: boolean;
  notice: string;
  refresh: (withEvents?: boolean) => Promise<void>;
  connect: (url: string, apiKey?: string) => Promise<RemoteApiResponse>;
  disconnect: () => Promise<RemoteApiResponse>;
  mapApiError: (
    response?: RemoteApiResponse | null,
    fallbackMessage?: string,
  ) => RemoteErrorUi;
}

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const sanitizeSession = (session: RemoteRuntimeStatus["session"]) => {
  if (!session) return null;
  const { apiKey: _apiKey, ...rest } = session as any;
  return rest;
};

const toRuntime = (
  payload: RemoteRuntimeStatus | undefined,
  remoteText: RemoteRuntimeText,
): RemoteRuntimeStatus => ({
  ...createDefaultRuntime(remoteText.noticeDefault),
  ...(payload || {}),
  session: sanitizeSession(payload?.session),
  notice:
    resolveRemoteRuntimeToken(payload?.notice, remoteText) ||
    remoteText.noticeDefault,
});

const toNetwork = (
  payload: RemoteNetworkStatus | undefined,
  remoteText: RemoteRuntimeText,
): RemoteNetworkStatus => ({
  ...createDefaultNetwork(remoteText.noticeDefault),
  ...(payload || {}),
  session: sanitizeSession(payload?.session),
  notice:
    resolveRemoteRuntimeToken(payload?.notice, remoteText) ||
    remoteText.noticeDefault,
});

const toDiagnostics = (
  payload: RemoteDiagnostics | undefined,
  remoteText: RemoteRuntimeText,
): RemoteDiagnostics => ({
  ...createDefaultDiagnostics(remoteText.noticeDefault),
  ...(payload || {}),
  session: sanitizeSession(payload?.session),
  notice:
    resolveRemoteRuntimeToken(payload?.notice, remoteText) ||
    remoteText.noticeDefault,
  network: toNetwork(payload?.network, remoteText),
});

const mapRemoteApiError = (
  t: (typeof translations)[Language]["remoteRuntime"],
  response?: RemoteApiResponse | null,
  fallbackMessage?: string,
): RemoteErrorUi => {
  const fallback = fallbackMessage || t.fallbackError;
  if (!response) {
    return {
      title: t.errorTitle,
      description: fallback,
      hint: t.errorHint,
    };
  }

  const code = response.code || "REMOTE_UNKNOWN";
  const description = response.message || fallback;
  const hint = resolveRemoteRuntimeHint(response.actionHint, t) || undefined;
  switch (code) {
    case "REMOTE_UNAUTHORIZED":
      return { title: t.unauthorizedTitle, description, hint };
    case "REMOTE_TIMEOUT":
      return { title: t.timeoutTitle, description, hint };
    case "REMOTE_NETWORK":
      return { title: t.networkTitle, description, hint };
    case "REMOTE_PROTOCOL":
      return { title: t.protocolTitle, description, hint };
    case "REMOTE_NOT_FOUND":
      return { title: t.notFoundTitle, description, hint };
    default:
      return { title: t.errorTitle, description, hint };
  }
};

const loadCachedSnapshot = (
  remoteText: RemoteRuntimeText,
): {
  runtime: RemoteRuntimeStatus;
  network: RemoteNetworkStatus;
  diagnostics: RemoteDiagnostics;
  events: RemoteNetworkEvent[];
  lastUpdatedAt: number | null;
} => {
  const notice = remoteText.noticeDefault;
  const fallback = {
    runtime: createDefaultRuntime(notice),
    network: createDefaultNetwork(notice),
    diagnostics: createDefaultDiagnostics(notice),
    events: [] as RemoteNetworkEvent[],
    lastUpdatedAt: null as number | null,
  };

  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as {
      runtime?: RemoteRuntimeStatus;
      network?: RemoteNetworkStatus;
      diagnostics?: RemoteDiagnostics;
      events?: RemoteNetworkEvent[];
      updatedAt?: number;
    };
    return {
      runtime: toRuntime(parsed.runtime, remoteText),
      network: toNetwork(parsed.network, remoteText),
      diagnostics: toDiagnostics(parsed.diagnostics, remoteText),
      events: Array.isArray(parsed.events) ? parsed.events : [],
      lastUpdatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : null,
    };
  } catch {
    return fallback;
  }
};

export function useRemoteRuntime(lang: Language): UseRemoteRuntimeResult {
  const remoteText = translations[lang].remoteRuntime;
  const cached = useMemo(
    () => loadCachedSnapshot(remoteText),
    [remoteText],
  );
  const [runtime, setRuntime] = useState<RemoteRuntimeStatus>(cached.runtime);
  const [network, setNetwork] = useState<RemoteNetworkStatus>(cached.network);
  const [diagnostics, setDiagnostics] = useState<RemoteDiagnostics>(
    cached.diagnostics,
  );
  const [networkEvents, setNetworkEvents] = useState<RemoteNetworkEvent[]>(
    cached.events,
  );
  const networkEventsRef = useRef<RemoteNetworkEvent[]>(cached.events);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(
    cached.lastUpdatedAt,
  );

  const persistCache = useCallback(
    (
      nextRuntime: RemoteRuntimeStatus,
      nextNetwork: RemoteNetworkStatus,
      nextDiagnostics: RemoteDiagnostics,
      nextEvents: RemoteNetworkEvent[],
      updatedAt: number,
    ) => {
      try {
        localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({
            runtime: nextRuntime,
            network: nextNetwork,
            diagnostics: nextDiagnostics,
            events: nextEvents,
            updatedAt,
          }),
        );
      } catch {
        // Ignore cache write failures
      }
    },
    [],
  );

  const refresh = useCallback(
    async (withEvents: boolean = true) => {
      const api = window.api;
      if (!api) {
        setLoading(false);
        return;
      }

      setRefreshing(true);
      try {
        const [statusResult, networkResult, diagnosticsResult] =
          await Promise.all([
            api.remoteStatus(),
            api.remoteNetworkStatus(),
            api.remoteDiagnostics(),
          ]);

        const nextRuntime = toRuntime(
          statusResult?.data,
          remoteText,
        );
        const nextNetwork = toNetwork(
          networkResult?.data,
          remoteText,
        );
        const nextDiagnostics = toDiagnostics(
          diagnosticsResult?.data,
          remoteText,
        );

        let nextEvents = networkEventsRef.current;
        if (withEvents) {
          const limit = nextRuntime.connected ? 80 : 20;
          const eventsResult = await api.remoteNetworkEvents(limit);
          if (eventsResult?.ok && Array.isArray(eventsResult.data)) {
            nextEvents = eventsResult.data;
            networkEventsRef.current = nextEvents;
            setNetworkEvents(nextEvents);
          }
        }

        if (!statusResult?.ok) {
          setLastError(
            resolveRemoteRuntimeToken(statusResult?.message, remoteText) ||
              remoteText.statusFetchFailed,
          );
        } else {
          setLastError(null);
        }

        setRuntime(nextRuntime);
        setNetwork(nextNetwork);
        setDiagnostics(nextDiagnostics);

        const updatedAt = Date.now();
        setLastUpdatedAt(updatedAt);
        persistCache(
          nextRuntime,
          nextNetwork,
          nextDiagnostics,
          nextEvents,
          updatedAt,
        );
      } catch (error) {
        setLastError(
          resolveRemoteRuntimeToken(toErrorMessage(error), remoteText) ||
            toErrorMessage(error),
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [persistCache, remoteText],
  );

  const connect = useCallback(
    async (url: string, apiKey?: string): Promise<RemoteApiResponse> => {
      const api = window.api;
      if (!api) {
        return { ok: false, message: remoteText.apiUnavailable };
      }
      const response = await api.remoteConnect({
        url: url.trim(),
        apiKey: apiKey?.trim() || undefined,
      });
      await refresh(true);
      return response;
    },
    [refresh, remoteText.apiUnavailable],
  );

  const disconnect = useCallback(async (): Promise<RemoteApiResponse> => {
    const api = window.api;
    if (!api) {
      return { ok: false, message: remoteText.apiUnavailable };
    }
    const response = await api.remoteDisconnect();
    await refresh(true);
    return response;
  }, [refresh, remoteText.apiUnavailable]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      await refresh(true);
      if (cancelled) return;
      timer = setTimeout(
        loop,
        runtime.connected ? POLL_INTERVAL_CONNECTED_MS : POLL_INTERVAL_IDLE_MS,
      );
    };

    void loop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [refresh, runtime.connected]);

  return {
    runtime,
    network,
    diagnostics,
    networkEvents,
    loading,
    refreshing,
    lastError,
    lastUpdatedAt,
    isRemoteMode: runtime.executionMode === "remote" && runtime.connected,
    notice: runtime.notice || network.notice || remoteText.noticeDefault,
    refresh,
    connect,
    disconnect,
    mapApiError: (response, fallbackMessage) =>
      mapRemoteApiError(remoteText, response, fallbackMessage),
  };
}

export const __testOnly = {
  resolveRemoteRuntimeToken,
  resolveRemoteRuntimeHint,
};
