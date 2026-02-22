export type ProofreadEngineMode = "v1" | "v2";

export interface ProofreadRetranslateOptions {
  useV2: boolean;
  pipelineId: string;
}

export interface ProofreadLineLayoutMetrics {
  isSingleLineBlock: boolean;
  rowMinHeight: number;
  lineHeight: number;
  paddingLeft: number;
  paddingRight: number;
  lineNumberLeft: number;
  lineNumberWidth: number;
  lineNumberFontSize: number;
  textFontSize: number;
  textFontWeight: number;
  textVerticalPadding: number;
}

const trimString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const normalizeProofreadEngineMode = (
  value: unknown,
): ProofreadEngineMode => (trimString(value) === "v2" ? "v2" : "v1");

export const parseLegacyActivePipelineId = (raw: unknown): string => {
  const payload = trimString(raw);
  if (!payload) return "";
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed === "string" ? parsed.trim() : "";
  } catch {
    return "";
  }
};

export const resolveProofreadPipelineId = (
  primaryPipelineId: unknown,
  legacyPipelineRaw?: unknown,
): string => {
  const direct = trimString(primaryPipelineId);
  if (direct) return direct;
  return parseLegacyActivePipelineId(legacyPipelineRaw);
};

export const resolveProofreadRetranslateOptions = ({
  engineMode,
  pipelineId,
  legacyPipelineRaw,
}: {
  engineMode: unknown;
  pipelineId: unknown;
  legacyPipelineRaw?: unknown;
}): ProofreadRetranslateOptions => {
  const mode = normalizeProofreadEngineMode(engineMode);
  if (mode !== "v2") {
    return { useV2: false, pipelineId: "" };
  }
  return {
    useV2: true,
    pipelineId: resolveProofreadPipelineId(pipelineId, legacyPipelineRaw),
  };
};

export const buildProofreadLineLayoutMetrics = (
  maxLines: number,
): ProofreadLineLayoutMetrics => {
  const safeMaxLines = Number.isFinite(maxLines) ? Math.max(1, maxLines) : 1;
  const isSingleLineBlock = safeMaxLines === 1;
  if (isSingleLineBlock) {
    return {
      isSingleLineBlock: true,
      rowMinHeight: 28,
      lineHeight: 24,
      paddingLeft: 40,
      paddingRight: 14,
      lineNumberLeft: 10,
      lineNumberWidth: 22,
      lineNumberFontSize: 11,
      textFontSize: 13.5,
      textFontWeight: 500,
      textVerticalPadding: 2,
    };
  }
  return {
    isSingleLineBlock: false,
    rowMinHeight: 20,
    lineHeight: 20,
    paddingLeft: 44,
    paddingRight: 12,
    lineNumberLeft: 12,
    lineNumberWidth: 24,
    lineNumberFontSize: 10,
    textFontSize: 13,
    textFontWeight: 400,
    textVerticalPadding: 0,
  };
};
