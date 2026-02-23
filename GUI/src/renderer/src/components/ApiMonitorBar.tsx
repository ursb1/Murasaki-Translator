import { Server, Activity, Clock, Globe } from "lucide-react";
import { translations, Language } from "../lib/i18n";
import { Tooltip } from "./ui/core";

export interface ApiMonitorData {
  url: string;
  latencyMs: number | null;
  rpm: number;
  concurrency: number;
}

interface ApiMonitorBarProps {
  data: ApiMonitorData;
  lang: Language;
  isRunning: boolean;
}

export function ApiMonitorBar({ data, lang, isRunning }: ApiMonitorBarProps) {
  const t = translations[lang];
  const isOffline = !data.url;
  const tone = {
    info: "text-sky-500 dark:text-sky-400",
    good: "text-emerald-500 dark:text-emerald-400",
    warn: "text-amber-500 dark:text-amber-400",
    bad: "text-rose-500 dark:text-rose-400",
    neutral: "text-muted-foreground",
    idle: "text-foreground/80",
  } as const;

  // URL Display Logic: Extract hostname if possible
  let displayUrl = t.monitor.apiWaiting;
  const fullUrl = data.url;

  if (data.url) {
    try {
      const parsed = new URL(data.url);
      displayUrl = parsed.hostname + (parsed.port ? `:${parsed.port}` : "");
    } catch {
      displayUrl = data.url; // Fallback to raw if not valid URL
    }
  }

  const getLatencyColor = (latencyMs: number | null) => {
    if (latencyMs === null) return tone.neutral;
    // Latency is request round-trip time, not ICMP ping. Use relaxed thresholds.
    if (latencyMs > 12000) return tone.bad;
    if (latencyMs > 6000) return tone.warn;
    return tone.good;
  };

  const getEndpointColor = () => {
    if (isOffline) return tone.neutral;
    if (!isRunning) return tone.idle;
    if (data.latencyMs !== null && data.latencyMs > 12000) return tone.bad;
    if (data.latencyMs !== null && data.latencyMs > 6000) return tone.warn;
    return tone.info;
  };

  // RPM Color
  const getRpmColor = (rpm: number) => {
    if (!isRunning) return tone.neutral;
    if (rpm > 500) return tone.bad;
    if (rpm > 100) return tone.warn;
    if (rpm > 0) return tone.good;
    return tone.neutral;
  };

  const getConcurrencyColor = (concurrency: number) => {
    if (!isRunning || concurrency <= 0) return tone.neutral;
    return tone.good;
  };

  return (
    <div
      className="w-full bg-card border-b border-border pl-3 pr-5 py-2.5 flex items-center justify-between text-xs font-mono select-none transition-colors dark:bg-card/90"
    >
      {/* API URL - 允许收缩 */}
      <div className="flex items-center gap-2 text-muted-foreground min-w-0 shrink flex-1 mr-2 overflow-hidden">
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span
          className={`truncate font-medium ${getEndpointColor()} ${isOffline ? "opacity-70" : ""}`}
          title={fullUrl}
        >
          {displayUrl}
        </span>
      </div>

      {/* RPM & Concurrency - 核心显示区域 */}
      <div className="flex items-center gap-4 text-muted-foreground justify-center min-w-[150px] shrink-0">
        <Tooltip content={t.monitor.apiRpmTooltip}>
          <div className="flex items-center gap-1.5 shrink-0">
            <Activity className="w-3.5 h-3.5" />
            <span>{t.monitor.apiRpmLabel}</span>
            <span
              className={`font-mono font-bold w-10 text-right ${getRpmColor(data.rpm)}`}
            >
              {isRunning ? data.rpm.toFixed(1) : "-"}
            </span>
          </div>
        </Tooltip>

        <div className="w-px h-3.5 bg-border/60" />

        <Tooltip content={t.monitor.apiConcurrencyTooltip}>
          <div className="flex items-center gap-1.5 shrink-0">
            <Server className="w-3.5 h-3.5" />
            <span>{t.monitor.apiConcurrency}</span>
            <span
              className={`font-mono font-bold w-4 text-right ${getConcurrencyColor(data.concurrency)}`}
            >
              {isRunning && data.concurrency > 0 ? `${data.concurrency}` : "-"}
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Latency Stats - 紧凑显示 */}
      <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-3">
        <div className="w-px h-3.5 bg-border" />
        <Tooltip content={t.monitor.apiLatencyTooltip}>
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>{t.monitor.apiLatencyLabel}</span>
            <span
              className={`font-bold font-mono w-14 text-right ${getLatencyColor(data.latencyMs)}`}
            >
              {data.latencyMs !== null ? `${Math.round(data.latencyMs)}ms` : "-"}
            </span>
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
