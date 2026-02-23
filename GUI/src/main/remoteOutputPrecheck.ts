export interface RemoteOutputPrecheckInput {
  executionMode?: unknown;
  remoteUrl?: unknown;
  serverUrl?: unknown;
}

export interface RemoteOutputPrecheckResult {
  skipLocalProbe: boolean;
  remoteHost?: string;
}

const normalizeExecutionMode = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const normalizeRemoteUrl = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

const isLoopbackHost = (host: string): boolean =>
  host === "127.0.0.1" || host === "localhost";

export const resolveRemoteOutputPrecheck = (
  input: RemoteOutputPrecheckInput,
): RemoteOutputPrecheckResult => {
  const executionMode = normalizeExecutionMode(input.executionMode);
  if (executionMode !== "remote") {
    return { skipLocalProbe: false };
  }

  const remoteUrl = normalizeRemoteUrl(input.remoteUrl || input.serverUrl);
  if (!remoteUrl) {
    return { skipLocalProbe: false };
  }

  try {
    const parsed = new URL(remoteUrl);
    const host = parsed.hostname.toLowerCase();
    if (!isLoopbackHost(host)) {
      return {
        skipLocalProbe: true,
        remoteHost: host,
      };
    }
  } catch {
    // Ignore malformed URL and continue with local detection.
  }

  return { skipLocalProbe: false };
};

export const __testOnly = {
  isLoopbackHost,
};
