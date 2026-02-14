/**
 * ErrorBoundary - 全局错误边界组件
 * 捕获 React 渲染错误并显示友好界面
 */

import { Component, ReactNode } from "react";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { translations, Language } from "../lib/i18n";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: string;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: "",
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error);
    console.error("[ErrorBoundary] Error info:", errorInfo);
    this.setState({
      errorInfo: errorInfo.componentStack || "",
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  handleRetry = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: "",
      showDetails: false,
    });
  };

  handleCopy = async () => {
    const { error, errorInfo } = this.state;
    const payload = [
      error?.message ? `Error: ${error.message}` : "",
      errorInfo ? `Stack:\n${errorInfo}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");

    const resolveLang = (): Language => {
      const stored = localStorage.getItem("app_lang");
      if (stored === "zh" || stored === "en" || stored === "jp") {
        return stored;
      }
      const nav = (navigator?.language || "").toLowerCase();
      if (nav.startsWith("ja")) return "jp";
      if (nav.startsWith("en")) return "en";
      return "zh";
    };

    const lang = resolveLang();
    const t = translations[lang].errorBoundary;

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        window.prompt(t.copyPrompt, payload);
      }
      const { emitToast } = await import("../lib/toast");
      emitToast({ message: t.copyToast, variant: "success" });
    } catch {
      window.prompt(t.copyPrompt, payload);
    }
  };

  toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      const resolveLang = (): Language => {
        const stored = localStorage.getItem("app_lang");
        if (stored === "zh" || stored === "en" || stored === "jp") {
          return stored;
        }
        const nav = (navigator?.language || "").toLowerCase();
        if (nav.startsWith("ja")) return "jp";
        if (nav.startsWith("en")) return "en";
        return "zh";
      };

      const t = translations[resolveLang()].errorBoundary;

      return (
        <div className="flex items-center justify-center min-h-screen bg-background p-8">
          <div className="max-w-lg w-full bg-card border border-border rounded-xl p-8 shadow-lg">
            {/* 错误图标 */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-red-500/10 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-8 h-8 text-red-500" />
              </div>
            </div>

            {/* 错误标题 */}
            <h2 className="text-xl font-semibold text-center text-foreground mb-2">
              {t.title}
            </h2>
            <p className="text-muted-foreground text-center mb-6">
              {t.description}
            </p>

            {/* 错误信息 */}
            {this.state.error && (
              <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4 mb-6">
                <p className="text-sm text-red-400 font-mono break-all">
                  {this.state.error.message}
                </p>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 mb-4">
              <button
                onClick={this.handleRetry}
                className="flex-1 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                {t.retry}
              </button>
              <button
                onClick={this.handleReload}
                className="flex-1 px-4 py-2.5 bg-secondary text-secondary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity"
              >
                {t.reload}
              </button>
            </div>

            {/* 详细信息折叠 */}
            {this.state.errorInfo && (
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                  <button
                    onClick={this.toggleDetails}
                    className="flex items-center gap-2 hover:text-foreground transition-colors"
                  >
                    {this.state.showDetails ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                    {this.state.showDetails ? t.detailsHide : t.detailsShow}
                  </button>
                  <button
                    onClick={this.handleCopy}
                    className="text-xs hover:text-foreground transition-colors"
                  >
                    {t.copy}
                  </button>
                </div>
                {this.state.showDetails && (
                  <pre className="mt-3 p-3 bg-muted rounded-lg text-xs text-muted-foreground overflow-auto max-h-40 font-mono">
                    {this.state.errorInfo}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
