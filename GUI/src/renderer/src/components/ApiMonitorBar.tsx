import { Server, Activity, Clock, Globe } from "lucide-react";
import { translations, Language } from "../lib/i18n";
import { Tooltip } from "./ui/core";

export interface ApiMonitorData {
  url: string;
  ping: number | null;
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

  // Ping Color
  const getPingColor = (ping: number | null) => {
    if (ping === null) return "text-muted-foreground";
    if (ping > 2000) return "text-red-400";
    if (ping > 800) return "text-amber-400";
    return "text-emerald-400";
  };

  // RPM Color
  const getRpmColor = (rpm: number) => {
    if (!isRunning) return "text-muted-foreground";
    if (rpm > 100) return "text-red-400";
    if (rpm > 30) return "text-amber-400";
    if (rpm > 0) return "text-emerald-400";
    return "text-muted-foreground";
  };

  return (
    <div
      className="w-full bg-card border-b border-border pl-3 pr-5 py-2.5 flex items-center justify-between text-xs font-mono select-none transition-colors dark:bg-card/90"
    >
      {/* API URL - 允许收缩 */}
      <div className="flex items-center gap-2 text-muted-foreground min-w-0 shrink flex-1 mr-2 overflow-hidden">
        <Globe className="w-3.5 h-3.5 shrink-0" />
        <span
          className={`truncate font-medium ${isOffline ? "opacity-70" : isRunning ? "text-emerald-500/90" : "text-foreground/80"}`}
          title={fullUrl}
        >
          {displayUrl}
        </span>
      </div>

      {/* RPM & Concurrency - 核心显示区域 */}
      <div className="flex items-center gap-4 text-muted-foreground justify-center min-w-[150px] shrink-0">
        <Tooltip content="Requests Per Minute (RPM)">
          <div className="flex items-center gap-1.5 shrink-0">
            <Activity className="w-3.5 h-3.5" />
            <span>RPM</span>
            <span
              className={`font-mono font-bold w-10 text-right ${getRpmColor(data.rpm)}`}
            >
              {isRunning ? data.rpm.toFixed(1) : "-"}
            </span>
          </div>
        </Tooltip>

        <div className="w-px h-3.5 bg-border/60" />

        <Tooltip content="Active Concurrency Limit">
          <div className="flex items-center gap-1.5 shrink-0">
            <Server className="w-3.5 h-3.5" />
            <span>{t.monitor.apiConcurrency}</span>
            <span
              className={`font-mono font-bold w-4 text-right ${isRunning && data.concurrency > 0 ? "text-emerald-400" : ""}`}
            >
              {isRunning && data.concurrency > 0 ? `${data.concurrency}` : "-"}
            </span>
          </div>
        </Tooltip>
      </div>

      {/* Ping Stats - 紧凑显示 */}
      <div className="flex items-center gap-3 text-muted-foreground shrink-0 ml-3">
        <div className="w-px h-3.5 bg-border" />
        <Tooltip content="API Server Latency (Ping)">
          <div className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" />
            <span>响应延迟</span>
            <span
              className={`font-bold font-mono w-12 text-right ${getPingColor(data.ping)}`}
            >
              {data.ping !== null ? `${data.ping}ms` : "-"}
            </span>
          </div>
        </Tooltip>
      </div>
    </div>
  );
}
