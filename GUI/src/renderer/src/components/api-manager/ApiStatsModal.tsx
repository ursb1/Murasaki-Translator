import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  BarChart3,
  Clock3,
  PieChart as PieChartIcon,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
} from "../ui/core";
import { Select } from "../ui/Select";
import { AlertModal } from "../ui/AlertModal";
import { useAlertModal } from "../../hooks/useAlertModal";
import { translations, type Language } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { emitToast } from "../../lib/toast";
import type {
  ApiStatsBreakdown,
  ApiStatsOverview,
  ApiStatsRecord,
  ApiStatsRecords,
  ApiStatsTrend,
} from "../../types/api";

type ApiStatsModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lang: Language;
  apiProfileId?: string;
  apiName?: string;
};

type RangeKey = "24h" | "7d" | "30d" | "all";
type TrendMetric =
  | "requests"
  | "latency"
  | "input_tokens"
  | "output_tokens"
  | "error_rate"
  | "success_rate";
type BreakdownDimension =
  | "status_code"
  | "status_class"
  | "source"
  | "error_type"
  | "model"
  | "hour";
type RecordPhase = "all" | "request_end" | "request_error" | "inflight";

type StatsTexts = {
  open: string;
  title: string;
  subtitle: string;
  profileLabel: string;
  noProfile: string;
  refresh: string;
  close: string;
  clear: string;
  clearConfirm: string;
  clearSuccess: string;
  clearFail: string;
  loading: string;
  noData: string;
  loadFail: string;
  overview: string;
  trend: string;
  breakdown: string;
  records: string;
  ranges: {
    label: string;
    d24h: string;
    d7d: string;
    d30d: string;
    all: string;
  };
  metrics: {
    label: string;
    requests: string;
    latency: string;
    inputTokens: string;
    outputTokens: string;
    errorRate: string;
    successRate: string;
  };
  dimensions: {
    label: string;
    statusCode: string;
    statusClass: string;
    source: string;
    errorType: string;
    model: string;
    hour: string;
  };
  cards: {
    totalRequests: string;
    successRequests: string;
    failedRequests: string;
    inflightRequests: string;
    successRate: string;
    failureRate: string;
    avgLatency: string;
    p95Latency: string;
    fastestLatency: string;
    slowestLatency: string;
    inputTokens: string;
    outputTokens: string;
    totalTokens: string;
    outputInputRatio: string;
    retries: string;
    avgRetries: string;
    rpmAvg: string;
    rpmPeak: string;
    status2xx: string;
    status4xx: string;
    status5xx: string;
    firstRequest: string;
    latestRequest: string;
    observationWindow: string;
  };
  charts: {
    hourTitle: string;
    statusClassTitle: string;
  };
  details: {
    title: string;
    requestPayload: string;
    responsePayload: string;
    meta: string;
    requestHeaders: string;
    responseHeaders: string;
    empty: string;
  };
  filters: {
    queryPlaceholder: string;
    statusAll: string;
    sourceAll: string;
    phaseAll: string;
    phaseEnd: string;
    phaseError: string;
    phaseInflight: string;
  };
  table: {
    time: string;
    requestId: string;
    source: string;
    model: string;
    status: string;
    latency: string;
    tokens: string;
    endpoint: string;
    error: string;
    detail: string;
  };
  pager: {
    prev: string;
    next: string;
    info: string;
  };
};

const FALLBACK_TEXTS = translations.zh.apiManager.apiStats as StatsTexts;
const CHART_COLORS = ["#22c55e", "#3b82f6", "#f97316", "#ef4444", "#a855f7", "#14b8a6"];
const RECORD_PAGE_SIZE = 20;

const toLocale = (lang: Language) => {
  if (lang === "en") return "en-US";
  if (lang === "jp") return "ja-JP";
  return "zh-CN";
};

const formatDateTime = (value: string | undefined, locale: string) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

const formatNumber = (value: number | undefined) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return Intl.NumberFormat("en-US").format(value);
};

const formatPercent = (value: number | undefined, digits = 2) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}%`;
};

const formatMs = (value: number | undefined) => {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${formatNumber(Math.round(value))} ms`;
};

const formatWindow = (minutes: number | undefined) => {
  if (minutes === undefined || minutes === null || Number.isNaN(minutes)) return "-";
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
};

const formatRatio = (value: number | undefined, digits = 2, suffix = "x") => {
  if (value === undefined || value === null || Number.isNaN(value)) return "-";
  return `${value.toFixed(digits)}${suffix}`;
};

const stringifyJson = (value: unknown, emptyText: string) => {
  if (value === undefined || value === null) return emptyText;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
};

const resolveRange = (rangeKey: RangeKey) => {
  if (rangeKey === "all") return {};
  const now = Date.now();
  const ms =
    rangeKey === "24h"
      ? 24 * 60 * 60 * 1000
      : rangeKey === "7d"
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
  return {
    fromTs: new Date(now - ms).toISOString(),
    toTs: new Date(now).toISOString(),
  };
};

const resolveTrendInterval = (rangeKey: RangeKey): "minute" | "hour" | "day" => {
  if (rangeKey === "24h") return "hour";
  if (rangeKey === "7d") return "hour";
  return "day";
};

const resolvePhaseLabel = (phase: RecordPhase, texts: StatsTexts["filters"]) => {
  if (phase === "request_end") return texts.phaseEnd;
  if (phase === "request_error") return texts.phaseError;
  if (phase === "inflight") return texts.phaseInflight;
  return texts.phaseAll;
};

const buildTrendLabel = (
  value: string,
  interval: "minute" | "hour" | "day",
  locale: string,
) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  if (interval === "day") {
    return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit" }).format(date);
  }
  if (interval === "hour") {
    return new Intl.DateTimeFormat(locale, { month: "2-digit", day: "2-digit", hour: "2-digit" }).format(date);
  }
  return new Intl.DateTimeFormat(locale, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export function ApiStatsModal({
  open,
  onOpenChange,
  lang,
  apiProfileId,
  apiName,
}: ApiStatsModalProps) {
  const locale = toLocale(lang);
  const { alertProps, showConfirm } = useAlertModal();
  const branch = translations[lang]?.apiManager?.apiStats as Partial<StatsTexts> | undefined;
  const texts: StatsTexts = {
    ...FALLBACK_TEXTS,
    ...branch,
    ranges: {
      ...FALLBACK_TEXTS.ranges,
      ...(branch?.ranges || {}),
    },
    metrics: {
      ...FALLBACK_TEXTS.metrics,
      ...(branch?.metrics || {}),
    },
    dimensions: {
      ...FALLBACK_TEXTS.dimensions,
      ...(branch?.dimensions || {}),
    },
    cards: {
      ...FALLBACK_TEXTS.cards,
      ...(branch?.cards || {}),
    },
    charts: {
      ...FALLBACK_TEXTS.charts,
      ...(branch?.charts || {}),
    },
    details: {
      ...FALLBACK_TEXTS.details,
      ...(branch?.details || {}),
    },
    filters: {
      ...FALLBACK_TEXTS.filters,
      ...(branch?.filters || {}),
    },
    table: {
      ...FALLBACK_TEXTS.table,
      ...(branch?.table || {}),
    },
    pager: {
      ...FALLBACK_TEXTS.pager,
      ...(branch?.pager || {}),
    },
  } as StatsTexts;
  const langTexts = translations[lang] ?? translations.zh;
  const expandLabel = langTexts.common?.expand || "Expand";
  const collapseLabel = langTexts.common?.collapse || "Collapse";
  const copyRecordLabel =
    (langTexts as any)?.serviceView?.copy || langTexts.errorBoundary?.copy || "Copy";
  const copySuccessText =
    (langTexts as any)?.serviceView?.copied ||
    langTexts.errorBoundary?.copyToast ||
    "Copied";
  const copyFailText =
    (langTexts as any)?.serviceView?.copyFailTitle || texts.clearFail;

  const [rangeKey, setRangeKey] = useState<RangeKey>("7d");
  const [metric, setMetric] = useState<TrendMetric>("requests");
  const [dimension, setDimension] = useState<BreakdownDimension>("status_code");
  const [phase, setPhase] = useState<RecordPhase>("all");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [page, setPage] = useState(1);

  const [overview, setOverview] = useState<ApiStatsOverview | null>(null);
  const [trend, setTrend] = useState<ApiStatsTrend | null>(null);
  const [breakdown, setBreakdown] = useState<ApiStatsBreakdown | null>(null);
  const [records, setRecords] = useState<ApiStatsRecords | null>(null);

  const [loadingTop, setLoadingTop] = useState(false);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [errorMessage, setErrorMessage] = useState("");
  const [expandedRequestId, setExpandedRequestId] = useState<string | null>(null);

  const rangePayload = useMemo(() => resolveRange(rangeKey), [rangeKey]);
  const interval = useMemo(() => resolveTrendInterval(rangeKey), [rangeKey]);

  useEffect(() => {
    if (!open) return;
    if (!apiProfileId) {
      setOverview(null);
      setTrend(null);
      setBreakdown(null);
      setRecords(null);
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoadingTop(true);
      setErrorMessage("");
      try {
        const [overviewRes, trendRes, breakdownRes] = await Promise.all([
          window.api.apiStatsOverview({ apiProfileId, ...rangePayload }),
          window.api.apiStatsTrend({
            apiProfileId,
            ...rangePayload,
            metric,
            interval,
          }),
          window.api.apiStatsBreakdown({
            apiProfileId,
            ...rangePayload,
            dimension,
          }),
        ]);

        if (cancelled) return;

        if (!overviewRes?.ok || !overviewRes.data) {
          throw new Error(overviewRes?.error || texts.loadFail);
        }
        if (!trendRes?.ok || !trendRes.data) {
          throw new Error(trendRes?.error || texts.loadFail);
        }
        if (!breakdownRes?.ok || !breakdownRes.data) {
          throw new Error(breakdownRes?.error || texts.loadFail);
        }

        setOverview(overviewRes.data);
        setTrend(trendRes.data);
        setBreakdown(breakdownRes.data);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(String((error as Error)?.message || texts.loadFail));
      } finally {
        if (!cancelled) setLoadingTop(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    apiProfileId,
    rangePayload,
    metric,
    interval,
    dimension,
    refreshToken,
    texts.loadFail,
  ]);

  useEffect(() => {
    if (!open) return;
    if (!apiProfileId) return;

    let cancelled = false;
    const run = async () => {
      setLoadingRecords(true);
      try {
        const result = await window.api.apiStatsRecords({
          apiProfileId,
          ...rangePayload,
          page,
          pageSize: RECORD_PAGE_SIZE,
          query: query.trim() || undefined,
          source: sourceFilter || undefined,
          statusCode: statusFilter ? Number(statusFilter) : undefined,
          phase: phase === "all" ? undefined : phase,
        });
        if (cancelled) return;
        if (!result?.ok || !result.data) {
          throw new Error(result?.error || texts.loadFail);
        }
        setRecords(result.data);
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(String((error as Error)?.message || texts.loadFail));
      } finally {
        if (!cancelled) setLoadingRecords(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    apiProfileId,
    rangePayload,
    page,
    query,
    sourceFilter,
    statusFilter,
    phase,
    refreshToken,
    texts.loadFail,
  ]);

  useEffect(() => {
    if (!open) return;
    setPage(1);
  }, [open, rangeKey, query, sourceFilter, statusFilter, phase]);

  useEffect(() => {
    if (!open) return;
    setExpandedRequestId(null);
  }, [open, page, query, sourceFilter, statusFilter, phase, refreshToken, apiProfileId]);

  const statusOptions = useMemo(() => {
    const source = overview?.statusCodeCounts || {};
    return Object.keys(source)
      .filter((key) => key !== "unknown")
      .sort((a, b) => Number(a) - Number(b));
  }, [overview?.statusCodeCounts]);

  const sourceOptions = useMemo(() => {
    const source = overview?.sourceCounts || {};
    return Object.keys(source).filter(Boolean).sort();
  }, [overview?.sourceCounts]);

  const totalPages = useMemo(() => {
    const total = records?.total || 0;
    return Math.max(1, Math.ceil(total / (records?.pageSize || RECORD_PAGE_SIZE)));
  }, [records]);

  if (!open) return null;

  const trendData =
    trend?.points.map((item) => ({
      ...item,
      label: buildTrendLabel(item.bucketStart, trend.interval, locale),
    })) || [];

  const breakdownData = (breakdown?.items || []).slice(0, 10);
  const statusClassData = [
    { key: "2xx", count: overview?.status2xx || 0, color: "#22c55e" },
    { key: "4xx", count: overview?.status4xx || 0, color: "#f97316" },
    { key: "5xx", count: overview?.status5xx || 0, color: "#ef4444" },
  ];
  const formatTrendValue = (value: number) => {
    if (metric === "latency") return `${formatNumber(Math.round(value))} ms`;
    if (metric === "error_rate" || metric === "success_rate") {
      return `${value.toFixed(2)}%`;
    }
    return formatNumber(value);
  };

  const handleRefresh = () => {
    setRefreshToken((prev) => prev + 1);
  };

  const handleClear = async () => {
    if (!apiProfileId) return;
    showConfirm({
      title: texts.clear,
      description: texts.clearConfirm,
      variant: "destructive",
      onConfirm: async () => {
        try {
          const result = await window.api.apiStatsClear({ apiProfileId });
          if (!result?.ok || !result.data) {
            throw new Error(result?.error || texts.clearFail);
          }
          emitToast({
            title: texts.clear,
            description: texts.clearSuccess.replace(
              "{count}",
              String(result.data.deleted || 0),
            ),
            variant: "success",
          });
          setPage(1);
          setRefreshToken((prev) => prev + 1);
        } catch (error) {
          emitToast({
            title: texts.clear,
            description: String((error as Error)?.message || texts.clearFail),
            variant: "error",
          });
        }
      },
    });
  };

  const handleCopyRecord = async (record: ApiStatsRecord) => {
    const payload = stringifyJson(record, "{}");
    let copied = false;
    let lastError = "";
    try {
      if (typeof window.api?.clipboardWrite === "function") {
        const result = await window.api.clipboardWrite(payload);
        if (result?.ok) {
          copied = true;
        } else {
          lastError = String(result?.error || "");
        }
      }
    } catch (error) {
      lastError = String((error as Error)?.message || "");
    }

    if (!copied && navigator?.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(payload);
        copied = true;
      } catch (error) {
        if (!lastError) {
          lastError = String((error as Error)?.message || "");
        }
      }
    }

    if (copied) {
      emitToast({
        title: copyRecordLabel,
        description: copySuccessText,
        variant: "success",
      });
      return;
    }

    window.prompt(copyRecordLabel, payload);
    emitToast({
      title: copyRecordLabel,
      description: lastError ? `${copyFailText}: ${lastError}` : copyFailText,
      variant: "error",
    });
  };

  const cardItems = [
    { key: "total", label: texts.cards.totalRequests, value: formatNumber(overview?.totalRequests) },
    { key: "inflight", label: texts.cards.inflightRequests, value: formatNumber(overview?.inflightRequests) },
    { key: "success", label: texts.cards.successRequests, value: formatNumber(overview?.successRequests) },
    { key: "failed", label: texts.cards.failedRequests, value: formatNumber(overview?.failedRequests) },
    { key: "successRate", label: texts.cards.successRate, value: formatPercent(overview?.successRate) },
    { key: "failureRate", label: texts.cards.failureRate, value: formatPercent(overview?.failureRate) },
    { key: "avgLatency", label: texts.cards.avgLatency, value: formatMs(overview?.avgLatencyMs) },
    { key: "p95Latency", label: texts.cards.p95Latency, value: formatMs(overview?.p95LatencyMs) },
    { key: "fastestLatency", label: texts.cards.fastestLatency, value: formatMs(overview?.fastestLatencyMs) },
    { key: "slowestLatency", label: texts.cards.slowestLatency, value: formatMs(overview?.slowestLatencyMs) },
    { key: "rpmAvg", label: texts.cards.rpmAvg, value: formatNumber(overview?.requestsPerMinuteAvg) },
    { key: "rpmPeak", label: texts.cards.rpmPeak, value: formatNumber(overview?.peakRequestsPerMinute) },
    { key: "retries", label: texts.cards.retries, value: formatNumber(overview?.totalRetries) },
    { key: "avgRetries", label: texts.cards.avgRetries, value: formatNumber(overview?.avgRetriesPerRequest) },
    { key: "tokensIn", label: texts.cards.inputTokens, value: formatNumber(overview?.totalInputTokens) },
    { key: "tokensOut", label: texts.cards.outputTokens, value: formatNumber(overview?.totalOutputTokens) },
    { key: "tokensTotal", label: texts.cards.totalTokens, value: formatNumber(overview?.totalTokens) },
    {
      key: "outputInputRatio",
      label: texts.cards.outputInputRatio,
      value: formatRatio(overview?.outputInputRatio, 2, "x"),
    },
    { key: "status2xx", label: texts.cards.status2xx, value: formatNumber(overview?.status2xx) },
    { key: "status4xx", label: texts.cards.status4xx, value: formatNumber(overview?.status4xx) },
    { key: "status5xx", label: texts.cards.status5xx, value: formatNumber(overview?.status5xx) },
    { key: "firstRequest", label: texts.cards.firstRequest, value: formatDateTime(overview?.firstRequestAt, locale) },
    { key: "latestRequest", label: texts.cards.latestRequest, value: formatDateTime(overview?.latestRequestAt, locale) },
    { key: "observationWindow", label: texts.cards.observationWindow, value: formatWindow(overview?.observationWindowMinutes) },
  ];

  const noData = (overview?.totalRequests || 0) <= 0;

  const modalBody = (
    <div
      className="fixed inset-0 z-[var(--z-modal)] overflow-y-auto bg-black/65 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-200"
      onClick={(event) => {
        if (event.target === event.currentTarget) onOpenChange(false);
      }}
    >
      <div className="mx-auto flex min-h-full items-start justify-center sm:items-center">
      <Card className="w-[min(1560px,98vw)] h-[min(980px,calc(100vh-12px))] sm:h-[min(940px,94vh)] overflow-hidden border-border/50 bg-background/95 shadow-2xl">
        <CardHeader className="border-b border-border/40 bg-gradient-to-r from-muted/30 via-background/90 to-muted/20">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="text-lg flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                {texts.title}
              </CardTitle>
              <CardDescription>
                {texts.subtitle}
              </CardDescription>
              <div className="text-xs text-muted-foreground">
                {texts.profileLabel}: <span className="font-mono">{apiProfileId || texts.noProfile}</span>
                {apiName ? <span className="ml-2">({apiName})</span> : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={handleRefresh}>
                <RefreshCw className={cn("h-4 w-4 mr-2", loadingTop || loadingRecords ? "animate-spin" : "")} />
                {texts.refresh}
              </Button>
              <Button size="sm" variant="outline" onClick={handleClear} disabled={!apiProfileId}>
                <Trash2 className="h-4 w-4 mr-2" />
                {texts.clear}
              </Button>
              <Button size="icon" variant="ghost" onClick={() => onOpenChange(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="h-[calc(100%-96px)] overflow-y-auto overflow-x-hidden p-3 sm:p-4">
          {!apiProfileId ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">{texts.noProfile}</div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-muted/20 p-3 sm:p-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{texts.ranges.label}</div>
                  <Select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={rangeKey}
                    onChange={(e) => setRangeKey(e.target.value as RangeKey)}
                  >
                    <option value="24h">{texts.ranges.d24h}</option>
                    <option value="7d">{texts.ranges.d7d}</option>
                    <option value="30d">{texts.ranges.d30d}</option>
                    <option value="all">{texts.ranges.all}</option>
                  </Select>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{texts.metrics.label}</div>
                  <Select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={metric}
                    onChange={(e) => setMetric(e.target.value as TrendMetric)}
                  >
                    <option value="requests">{texts.metrics.requests}</option>
                    <option value="latency">{texts.metrics.latency}</option>
                    <option value="input_tokens">{texts.metrics.inputTokens}</option>
                    <option value="output_tokens">{texts.metrics.outputTokens}</option>
                    <option value="error_rate">{texts.metrics.errorRate}</option>
                    <option value="success_rate">{texts.metrics.successRate}</option>
                  </Select>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{texts.dimensions.label}</div>
                  <Select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={dimension}
                    onChange={(e) => setDimension(e.target.value as BreakdownDimension)}
                  >
                    <option value="status_code">{texts.dimensions.statusCode}</option>
                    <option value="status_class">{texts.dimensions.statusClass}</option>
                    <option value="source">{texts.dimensions.source}</option>
                    <option value="error_type">{texts.dimensions.errorType}</option>
                    <option value="model">{texts.dimensions.model}</option>
                    <option value="hour">{texts.dimensions.hour}</option>
                  </Select>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{texts.filters.phaseAll}</div>
                  <Select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={phase}
                    onChange={(e) => setPhase(e.target.value as RecordPhase)}
                  >
                    <option value="all">{texts.filters.phaseAll}</option>
                    <option value="request_end">{texts.filters.phaseEnd}</option>
                    <option value="request_error">{texts.filters.phaseError}</option>
                    <option value="inflight">{texts.filters.phaseInflight}</option>
                  </Select>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{texts.filters.statusAll}</div>
                  <Select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="">{texts.filters.statusAll}</option>
                    {statusOptions.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <div className="text-[11px] text-muted-foreground mb-1">{texts.filters.sourceAll}</div>
                  <Select
                    className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                  >
                    <option value="">{texts.filters.sourceAll}</option>
                    {sourceOptions.map((sourceKey) => (
                      <option key={sourceKey} value={sourceKey}>
                        {sourceKey}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2 sm:gap-3">
                {cardItems.map((item) => (
                  <div
                    key={item.key}
                    className="rounded-xl border border-border/60 bg-gradient-to-br from-background via-muted/10 to-muted/20 px-3 py-2.5"
                  >
                    <div className="text-[11px] text-muted-foreground">{item.label}</div>
                    <div className="text-base font-semibold mt-1">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 xl:grid-cols-[1.4fr_1fr] gap-3">
                <div className="grid gap-3">
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <BarChart3 className="h-4 w-4" />
                      {texts.trend}
                    </div>
                    <div className="h-[260px] md:h-[300px]">
                      {trendData.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                            <XAxis dataKey="label" minTickGap={24} tick={{ fontSize: 11 }} />
                            <YAxis
                              tick={{ fontSize: 11 }}
                              domain={
                                metric === "error_rate" || metric === "success_rate"
                                  ? [0, 100]
                                  : ["auto", "auto"]
                              }
                            />
                            <Tooltip
                              formatter={(value) => formatTrendValue(Number(value ?? 0))}
                            />
                            <Line
                              type="monotone"
                              dataKey="value"
                              stroke="#22c55e"
                              strokeWidth={2}
                              dot={false}
                            />
                            {metric === "requests" ? (
                              <Line
                                type="monotone"
                                dataKey="errors"
                                stroke="#ef4444"
                                strokeWidth={1.5}
                                dot={false}
                                name={texts.cards.failedRequests}
                              />
                            ) : null}
                          </LineChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                          {loadingTop ? texts.loading : texts.noData}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <Clock3 className="h-4 w-4" />
                      {texts.charts.hourTitle}
                    </div>
                    <div className="h-[220px] md:h-[240px]">
                      {overview?.byHour?.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={overview.byHour}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                            <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} />
                            <Tooltip formatter={(value) => formatNumber(Number(value))} />
                            <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                          {loadingTop ? texts.loading : texts.noData}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <PieChartIcon className="h-4 w-4" />
                      {texts.breakdown}
                    </div>
                    <div className="h-[260px] md:h-[300px]">
                      {breakdownData.length ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart>
                            <Pie
                              data={
                                breakdownData as unknown as Array<
                                  Record<string, string | number | undefined>
                                >
                              }
                              dataKey="count"
                              nameKey="key"
                              innerRadius={45}
                              outerRadius={85}
                              paddingAngle={2}
                            >
                              {breakdownData.map((item, index) => (
                                <Cell
                                  key={`${item.key}_${index}`}
                                  fill={CHART_COLORS[index % CHART_COLORS.length]}
                                />
                              ))}
                            </Pie>
                            <Tooltip formatter={(value) => formatNumber(Number(value))} />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                          {loadingTop ? texts.loading : texts.noData}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border/60 bg-background/70 p-3">
                    <div className="flex items-center gap-2 text-sm font-medium mb-2">
                      <BarChart3 className="h-4 w-4" />
                      {texts.charts.statusClassTitle}
                    </div>
                    <div className="h-[220px] md:h-[240px]">
                      {statusClassData.some((item) => item.count > 0) ? (
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={statusClassData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.25)" />
                            <XAxis dataKey="key" tick={{ fontSize: 11 }} />
                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                            <Tooltip formatter={(value) => formatNumber(Number(value))} />
                            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                              {statusClassData.map((item) => (
                                <Cell key={item.key} fill={item.color} />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                          {loadingTop ? texts.loading : texts.noData}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/70 p-3 flex flex-col">
                <div className="flex items-center gap-2 text-sm font-medium mb-2">{texts.records}</div>
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="pl-8"
                    placeholder={texts.filters.queryPlaceholder}
                  />
                </div>

                <div className="overflow-auto rounded-md border border-border/50 min-h-[280px] max-h-[52vh]">
                  <table className="min-w-[1160px] w-full text-xs">
                    <thead className="sticky top-0 bg-background/95">
                      <tr className="border-b border-border/60">
                        <th className="px-2 py-2 text-left font-medium">{texts.table.time}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.requestId}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.source}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.model}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.status}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.latency}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.tokens}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.endpoint}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.error}</th>
                        <th className="px-2 py-2 text-left font-medium">{texts.table.detail}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records?.items?.length ? (
                        records.items.map((record: ApiStatsRecord) => {
                          const isExpanded = expandedRequestId === record.requestId;
                          const detailSections = [
                            {
                              key: "request",
                              label: texts.details.requestPayload,
                              value: stringifyJson(record.requestPayload, texts.details.empty),
                            },
                            {
                              key: "response",
                              label: texts.details.responsePayload,
                              value: stringifyJson(record.responsePayload, texts.details.empty),
                            },
                            {
                              key: "meta",
                              label: texts.details.meta,
                              value: stringifyJson(record.meta, texts.details.empty),
                            },
                            {
                              key: "request_headers",
                              label: texts.details.requestHeaders,
                              value: stringifyJson(record.requestHeaders, texts.details.empty),
                            },
                            {
                              key: "response_headers",
                              label: texts.details.responseHeaders,
                              value: stringifyJson(record.responseHeaders, texts.details.empty),
                            },
                          ];
                          return [
                            <tr key={record.requestId} className="border-b border-border/40 odd:bg-muted/10">
                              <td className="px-2 py-1.5 whitespace-nowrap">
                                {formatDateTime(record.startedAt, locale)}
                              </td>
                              <td className="px-2 py-1.5 font-mono">{record.requestId.slice(0, 12)}</td>
                              <td className="px-2 py-1.5">{record.source}</td>
                              <td className="px-2 py-1.5">{record.model || "-"}</td>
                              <td className="px-2 py-1.5">
                                {record.statusCode !== undefined
                                  ? record.statusCode
                                  : resolvePhaseLabel(record.phaseFinal, texts.filters)}
                              </td>
                              <td className="px-2 py-1.5">{record.durationMs ?? "-"}</td>
                              <td className="px-2 py-1.5">
                                {record.inputTokens}/{record.outputTokens}
                              </td>
                              <td className="px-2 py-1.5">{record.endpointLabel || record.endpointId || "-"}</td>
                              <td className="px-2 py-1.5 text-destructive/90">{record.errorType || "-"}</td>
                              <td className="px-2 py-1.5">
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() =>
                                      setExpandedRequestId((prev) =>
                                        prev === record.requestId ? null : record.requestId,
                                      )
                                    }
                                  >
                                    {isExpanded ? collapseLabel : expandLabel}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-[11px]"
                                    onClick={() => void handleCopyRecord(record)}
                                  >
                                    {copyRecordLabel}
                                  </Button>
                                </div>
                              </td>
                            </tr>,
                            isExpanded ? (
                              <tr
                                key={`${record.requestId}_detail`}
                                className="border-b border-border/40 bg-muted/5"
                              >
                                <td colSpan={10} className="px-2 py-2">
                                  <div className="rounded-md border border-border/50 bg-muted/20 p-2.5">
                                    <div className="mb-2 flex items-center justify-between gap-2">
                                      <div className="text-[11px] font-medium text-muted-foreground">
                                        {texts.details.title}
                                      </div>
                                      <div className="text-[11px] font-mono text-muted-foreground">
                                        {record.requestId}
                                      </div>
                                    </div>
                                    <div className="grid gap-2 xl:grid-cols-2">
                                      {detailSections.map((section) => (
                                        <div
                                          key={section.key}
                                          className="rounded-md border border-border/50 bg-background/70 p-2"
                                        >
                                          <div className="text-[10px] text-muted-foreground uppercase">
                                            {section.label}
                                          </div>
                                          <pre className="mt-1 text-[11px] whitespace-pre-wrap break-all max-h-44 overflow-auto leading-relaxed">
                                            {section.value}
                                          </pre>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            ) : null,
                          ];
                        })
                      ) : (
                        <tr>
                          <td colSpan={10} className="px-3 py-5 text-center text-muted-foreground">
                            {loadingRecords ? texts.loading : texts.noData}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {texts.pager.info
                      .replace("{page}", String(records?.page || 1))
                      .replace("{pages}", String(totalPages))
                      .replace("{total}", String(records?.total || 0))}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={(records?.page || 1) <= 1}
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                    >
                      {texts.pager.prev}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={(records?.page || 1) >= totalPages}
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                    >
                      {texts.pager.next}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {errorMessage && (
            <div className="mt-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {errorMessage}
            </div>
          )}

          {noData && !loadingTop && !loadingRecords && !errorMessage && apiProfileId && (
            <div className="mt-2 text-xs text-muted-foreground">{texts.noData}</div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(modalBody, document.body)}
      <AlertModal {...alertProps} />
    </>
  );
}
