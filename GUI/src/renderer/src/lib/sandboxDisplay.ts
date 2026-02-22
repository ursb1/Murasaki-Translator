export type SandboxTabId = "pre" | "request" | "response" | "parsed" | "post";

export const resolveSandboxFailedTab = (
  stage: string,
): SandboxTabId | "" => {
  const normalized = String(stage || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "pre_process") return "pre";
  if (normalized === "prompt" || normalized === "request") return "request";
  if (normalized === "provider") return "response";
  if (normalized === "parser") return "parsed";
  if (normalized === "post_process" || normalized === "line_policy") {
    return "post";
  }
  return "";
};

export const extractSandboxParserCandidates = (details: unknown): string[] => {
  if (!details || typeof details !== "object") return [];
  const raw = (details as Record<string, unknown>).candidates;
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => String(item || "").trim())
    .filter((item) => item.length > 0);
};
