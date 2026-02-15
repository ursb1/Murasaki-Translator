import { useEffect, useMemo, useState } from "react";
import yaml from "js-yaml";
import {
  Card,
  CardContent,
  Button,
  Input,
  Label,
} from "./ui/core";
import { translations, Language } from "../lib/i18n";
import { emitToast } from "../lib/toast";
import {
  Play,
  RefreshCw,
  Save,
  Trash2,
  Plus,
  Activity,
  Sparkles,
  ChevronDown,
  Boxes,
  FolderOpen,
  Wand2,
  Eye,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { cn } from "../lib/utils";
import {
  PipelineGraphView,
  type PipelineGraphNodeItem,
} from "./PipelineGraphView";

type ProfileKind = "api" | "pipeline" | "prompt" | "parser" | "policy" | "chunk";
type ViewMode = "api" | "advanced";

type ApiFormState = {
  id: string;
  name: string;
  apiType: "openai_compat" | "pool";
  baseUrl: string;
  apiKey: string;
  model: string;
  members: string;
  headers: string;
  params: string;
  timeout: string;
};

type ApiPreset = {
  key: string;
  defaultId: string;
  baseUrl: string;
  model: string;
};

type ApiProfileDetail = {
  id: string;
  name: string;
  data?: any;
  group: string;
};

type ApiTestState = {
  status: "idle" | "testing" | "success" | "error";
  message?: string;
  latencyMs?: number;
  statusCode?: number;
  url?: string;
};

type PipelineV2Status = {
  mode: "server" | "local";
  ok: boolean;
  error?: string;
  detail?: string;
};

type PipelineComposerState = {
  id: string;
  name: string;
  provider: string;
  prompt: string;
  parser: string;
  linePolicy: string;
  chunkPolicy: string;
  applyLinePolicy: boolean;
  temperature: string;
  maxRetries: string;
};

type TemplateDefinition = {
  key: string;
  kind: ProfileKind;
  yaml: string;
};

const PROFILE_KINDS: ProfileKind[] = [
  "api",
  "pipeline",
  "prompt",
  "parser",
  "policy",
  "chunk",
];

const DEFAULT_TEMPLATES: Record<ProfileKind, string> = {
  api: `id: new_api\nname: New API\ntype: openai_compat\nbase_url: https://api.openai.com/v1\napi_key: ""\nmodel: gpt-4o-mini\ntimeout: 600\nheaders: {}\nparams: {}`,
  pipeline: `id: new_pipeline\nname: New Pipeline\nprovider: openai_default\nprompt: prompt_default\nparser: parser_plain\nline_policy: line_tolerant\nchunk_policy: chunk_legacy_doc\napply_line_policy: false\nsettings:\n  temperature: 0.7\n  max_retries: 1`,
  prompt: `id: new_prompt\nname: New Prompt\nsystem_template: |\n  You are a translator.\nuser_template: |\n  {{source}}\ncontext:\n  before_lines: 0\n  after_lines: 0\n  joiner: "\\n"`,
  parser: `id: new_parser\nname: New Parser\ntype: plain`,
  policy: `id: new_line_policy\nname: New Line Policy\ntype: tolerant`,
  chunk: `id: new_chunk_policy\nname: New Chunk Policy\nchunk_type: legacy\noptions:\n  mode: doc\n  target_chars: 1000\n  max_chars: 2000`,
};

const DEFAULT_API_FORM: ApiFormState = {
  id: "",
  name: "",
  apiType: "openai_compat",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  members: "",
  headers: "",
  params: "",
  timeout: "600",
};

const DEFAULT_PIPELINE_COMPOSER: PipelineComposerState = {
  id: "",
  name: "",
  provider: "",
  prompt: "",
  parser: "",
  linePolicy: "",
  chunkPolicy: "",
  applyLinePolicy: false,
  temperature: "",
  maxRetries: "",
};

const API_PRESETS: ApiPreset[] = [
  {
    key: "openai",
    defaultId: "openai_default",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    key: "anthropic",
    defaultId: "anthropic_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "google",
    defaultId: "google_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "deepseek",
    defaultId: "deepseek_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "zhipu",
    defaultId: "zhipu_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "alibaba",
    defaultId: "alibaba_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "moonshot",
    defaultId: "moonshot_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "silicon",
    defaultId: "silicon_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "volc",
    defaultId: "volc_default",
    baseUrl: "",
    model: "",
  },
  {
    key: "openrouter",
    defaultId: "openrouter_default",
    baseUrl: "",
    model: "",
  },
];

const CUSTOM_GROUPS = [
  { key: "openai", accent: "bg-emerald-500" },
  { key: "anthropic", accent: "bg-amber-500" },
  { key: "google", accent: "bg-sky-500" },
  { key: "deepseek", accent: "bg-indigo-500" },
  { key: "zhipu", accent: "bg-rose-500" },
  { key: "alibaba", accent: "bg-orange-500" },
  { key: "moonshot", accent: "bg-violet-500" },
  { key: "silicon", accent: "bg-cyan-500" },
  { key: "volc", accent: "bg-red-500" },
  { key: "openrouter", accent: "bg-slate-500" },
];

const TEMPLATE_LIBRARY: TemplateDefinition[] = [
  {
    key: "api_openai_basic",
    kind: "api",
    yaml:
      "id: openai_default\nname: OpenAI Default\ntype: openai_compat\nbase_url: https://api.openai.com/v1\napi_key: \"\"\nmodel: gpt-4o-mini\ntimeout: 600\nheaders: {}\nparams: {}",
  },
  {
    key: "api_pool_basic",
    kind: "api",
    yaml:
      "id: api_pool_default\nname: API Pool\ntype: pool\nmembers:\n  - openai_default\n  - deepseek_default\ntimeout: 600\nheaders: {}\nparams: {}",
  },
  {
    key: "pipeline_line_strict",
    kind: "pipeline",
    yaml:
      "id: pipeline_line_strict\nname: Line Strict Pipeline\nprovider: openai_default\nprompt: prompt_default\nparser: parser_line_strict\nline_policy: line_strict\nchunk_policy: chunk_line_strict\napply_line_policy: true\nsettings:\n  temperature: 0.3\n  max_retries: 2",
  },
  {
    key: "prompt_tagged_line",
    kind: "prompt",
    yaml:
      "id: prompt_tagged_line\nname: Tagged Line Prompt\nsystem_template: |\n  Output format: @@<line_number>@@<translation>\nuser_template: |\n  @@{{line_number}}@@{{source}}\ncontext:\n  before_lines: 0\n  after_lines: 0\n  joiner: \"\\n\"",
  },
  {
    key: "parser_line_strict",
    kind: "parser",
    yaml: "id: parser_line_strict\nname: Line Strict Parser\ntype: line_strict",
  },
  {
    key: "parser_json_object",
    kind: "parser",
    yaml:
      "id: parser_json_object\nname: Json Object Parser\ntype: json_object\noptions:\n  path: translation",
  },
  {
    key: "policy_strict",
    kind: "policy",
    yaml: "id: line_strict\nname: Strict Line Policy\ntype: strict\noptions:\n  on_mismatch: error",
  },
  {
    key: "chunk_line_strict",
    kind: "chunk",
    yaml:
      "id: chunk_line_strict\nname: Line Strict Chunk\nchunk_type: line\noptions:\n  strict: true\n  keep_empty: true",
  },
];

type ValidationResult = { errors: string[]; warnings: string[] };

const formatErrorCode = (code: string, texts: any) => {
  if (code === "invalid_yaml") return texts.validationInvalidYaml;
  if (code === "missing_id") return texts.missingId;
  if (code.startsWith("missing_field:")) {
    const field = code.split(":")[1] || "";
    return texts.validationMissingField.replace("{field}", field);
  }
  if (code === "missing_base_url") return texts.validationMissingBaseUrl;
  if (code === "missing_model") return texts.validationMissingModel;
  if (code === "missing_members") return texts.validationMissingMembers;
  if (code === "missing_pattern") return texts.validationMissingPattern;
  if (code === "missing_json_path") return texts.validationMissingJsonPath;
  if (code.startsWith("unsupported_type:")) {
    const type = code.split(":")[1] || "";
    return texts.validationInvalidType.replace("{type}", type);
  }
  if (code.startsWith("missing_reference:")) {
    const parts = code.split(":");
    const kind = parts[1] || "";
    const id = parts[2] || "";
    return texts.validationUnknownReference.replace("{kind}", kind).replace("{id}", id);
  }
  return code;
};

const formatServerError = (error: any, fallback: string, texts: any) => {
  if (!error) return fallback;
  if (typeof error === "string") return error;
  if (Array.isArray(error?.errors)) {
    return error.errors.map((code: string) => formatErrorCode(code, texts)).join("\n");
  }
  if (Array.isArray(error?.detail)) {
    return error.detail.map((code: string) => formatErrorCode(code, texts)).join("\n");
  }
  if (typeof error?.detail === "string") return formatErrorCode(error.detail, texts);
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
};

const validateProfile = (
  kind: ProfileKind,
  data: any,
  index: Record<ProfileKind, string[]>,
  texts: any,
): ValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const missingField = (field: string) =>
    texts.validationMissingField.replace("{field}", field);
  const invalidType = (type: string) =>
    texts.validationInvalidType.replace("{type}", type);
  const unknownRef = (refKind: string, id: string) =>
    texts.validationUnknownReference
      .replace("{kind}", refKind)
      .replace("{id}", id);

  if (!data || typeof data !== "object") {
    errors.push(texts.validationInvalidYaml);
    return { errors, warnings };
  }
  if (!data.id) {
    errors.push(texts.missingId);
  }

  if (kind === "api") {
    const apiType = String(data.type || data.provider || "openai_compat");
    if (apiType === "openai_compat") {
      if (!data.base_url) errors.push(texts.validationMissingBaseUrl);
      if (!data.model) errors.push(texts.validationMissingModel);
    } else if (apiType === "pool") {
      if (!Array.isArray(data.members) || data.members.length === 0) {
        errors.push(texts.validationMissingMembers);
      }
    } else {
      warnings.push(invalidType(apiType));
    }
  }

  if (kind === "parser") {
    const parserType = String(data.type || "");
    if (!parserType) errors.push(missingField("type"));
    if (parserType === "regex") {
      if (!data.options?.pattern) {
        errors.push(texts.validationMissingPattern);
      }
    }
    if (parserType === "json_object") {
      if (!data.options?.path && !data.options?.key) {
        errors.push(texts.validationMissingJsonPath);
      }
    }
  }

  if (kind === "policy") {
    const policyType = String(data.type || "");
    if (!policyType) errors.push(missingField("type"));
    if (policyType && !["strict", "tolerant"].includes(policyType)) {
      warnings.push(invalidType(policyType));
    }
  }

  if (kind === "chunk") {
    const chunkType = String(data.chunk_type || data.type || "");
    if (!chunkType) errors.push(missingField("chunk_type"));
    if (chunkType && !["legacy", "line"].includes(chunkType)) {
      warnings.push(invalidType(chunkType));
    }
  }

  if (kind === "pipeline") {
    const required = ["provider", "prompt", "parser", "chunk_policy"];
    required.forEach((field) => {
      if (!data[field]) errors.push(texts.validationMissingPipeline.replace("{field}", field));
    });
    if (data.apply_line_policy && !data.line_policy) {
      errors.push(texts.validationMissingPipeline.replace("{field}", "line_policy"));
    }
    const refMap: Record<string, ProfileKind> = {
      provider: "api",
      prompt: "prompt",
      parser: "parser",
      line_policy: "policy",
      chunk_policy: "chunk",
    };
    Object.entries(refMap).forEach(([field, refKind]) => {
      const refId = data[field];
      if (!refId || !index[refKind]?.length) return;
      if (!index[refKind].includes(refId)) {
        warnings.push(unknownRef(refKind, refId));
      }
    });
  }

  return { errors, warnings };
};

const inferGroup = (data: any, fallbackId: string, fallbackName: string) => {
  const group = String(data?.provider_group || data?.group || "").toLowerCase();
  if (group) return group;
  const baseUrl = String(data?.base_url || data?.baseUrl || "");
  const combined = `${fallbackId} ${fallbackName} ${baseUrl}`.toLowerCase();
  if (combined.includes("openai")) return "openai";
  if (combined.includes("anthropic") || combined.includes("claude")) return "anthropic";
  if (combined.includes("google") || combined.includes("gemini")) return "google";
  if (combined.includes("deepseek")) return "deepseek";
  if (combined.includes("moonshot") || combined.includes("kimi")) return "moonshot";
  if (combined.includes("zhipu") || combined.includes("glm")) return "zhipu";
  if (combined.includes("alibaba") || combined.includes("qwen")) return "alibaba";
  if (combined.includes("volc") || combined.includes("doubao")) return "volc";
  if (combined.includes("silicon")) return "silicon";
  return "custom";
};

interface ApiManagerViewProps {
  lang: Language;
}

export function ApiManagerView({ lang }: ApiManagerViewProps) {
  const t = translations[lang];
  const texts = t.apiManager;

  const [viewMode, setViewMode] = useState<ViewMode>("api");
  const [profilesDir, setProfilesDir] = useState("");
  const [kind, setKind] = useState<ProfileKind>("api");
  const [profiles, setProfiles] = useState<{ id: string; name: string }[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [profileIndex, setProfileIndex] = useState<Record<ProfileKind, string[]>>({
    api: [],
    pipeline: [],
    prompt: [],
    parser: [],
    policy: [],
    chunk: [],
  });
  const [pipelineList, setPipelineList] = useState<{ id: string; name: string }[]>([]);
  const [runFilePath, setRunFilePath] = useState("");
  const [runPipeline, setRunPipeline] = useState("");
  const [runPipelineData, setRunPipelineData] = useState<any | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [apiForm, setApiForm] = useState<ApiFormState>(DEFAULT_API_FORM);
  const [apiProfiles, setApiProfiles] = useState<ApiProfileDetail[]>([]);
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [apiTest, setApiTest] = useState<ApiTestState>({ status: "idle" });
  const [pipelineStatus, setPipelineStatus] = useState<PipelineV2Status | null>(
    null,
  );
  const [showStatusDetail, setShowStatusDetail] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showGroups, setShowGroups] = useState(false);
  const [pipelineComposer, setPipelineComposer] = useState<PipelineComposerState>(
    DEFAULT_PIPELINE_COMPOSER,
  );

  const kindLabel = useMemo(() => texts.kinds[kind] || kind, [texts, kind]);

  const presetLabels = texts.presets ?? {};
  const groupLabels = texts.groups ?? {};

  const presets = useMemo(
    () =>
      API_PRESETS.map((preset) => ({
        ...preset,
        label: presetLabels[preset.key]?.label || preset.key,
      })),
    [presetLabels],
  );

  const activeGroupLabel = useMemo(() => {
    if (!activeGroup) return texts.groupEmpty;
    return groupLabels[activeGroup]?.title || texts.groupCustom;
  }, [activeGroup, groupLabels, texts]);

  const statItems = useMemo(
    () => [
      {
        label: texts.statsApi,
        value: String(apiProfiles.length),
        hint: texts.statsApiHint,
      },
      {
        label: texts.statsPipeline,
        value: String(pipelineList.length),
        hint: texts.statsPipelineHint,
      },
      {
        label: texts.statsGroup,
        value: activeGroupLabel,
        hint: texts.statsGroupHint,
      },
    ],
    [
      texts,
      apiProfiles.length,
      pipelineList.length,
      activeGroupLabel,
    ],
  );

  const groupProfiles = useMemo(() => {
    const grouped: Record<string, ApiProfileDetail[]> = {};
    for (const profile of apiProfiles) {
      if (!grouped[profile.group]) grouped[profile.group] = [];
      grouped[profile.group].push(profile);
    }
    return grouped;
  }, [apiProfiles]);

  const templatesForKind = useMemo(
    () => TEMPLATE_LIBRARY.filter((template) => template.kind === kind),
    [kind],
  );

  const pipelineGraphNodes = useMemo<PipelineGraphNodeItem[]>(
    () => [
      {
        id: "provider",
        label: texts.composer.nodes.provider,
        value: pipelineComposer.provider || texts.composer.nodes.empty,
      },
      {
        id: "prompt",
        label: texts.composer.nodes.prompt,
        value: pipelineComposer.prompt || texts.composer.nodes.empty,
      },
      {
        id: "parser",
        label: texts.composer.nodes.parser,
        value: pipelineComposer.parser || texts.composer.nodes.empty,
      },
      {
        id: "linePolicy",
        label: texts.composer.nodes.linePolicy,
        value: pipelineComposer.applyLinePolicy
          ? pipelineComposer.linePolicy || texts.composer.nodes.empty
          : texts.composer.nodes.skipped,
        muted: !pipelineComposer.applyLinePolicy,
      },
      {
        id: "chunkPolicy",
        label: texts.composer.nodes.chunkPolicy,
        value: pipelineComposer.chunkPolicy || texts.composer.nodes.empty,
      },
      {
        id: "output",
        label: texts.composer.nodes.output,
        value: texts.composer.nodes.outputValue,
      },
    ],
    [pipelineComposer, texts],
  );

  const parsedResult = useMemo(() => {
    if (!yamlText.trim()) return { data: null, error: "" };
    try {
      const data = yaml.load(yamlText) as any;
      if (!data || typeof data !== "object") {
        return { data: null, error: texts.validationInvalidYaml };
      }
      return { data, error: "" };
    } catch (error: any) {
      return {
        data: null,
        error: error?.message || texts.validationInvalidYaml,
      };
    }
  }, [yamlText, texts.validationInvalidYaml]);

  const validationResult = useMemo(() => {
    if (!parsedResult.data) return null;
    return validateProfile(kind, parsedResult.data, profileIndex, texts);
  }, [parsedResult.data, kind, profileIndex, texts]);

  const parseJsonField = (raw: string, fieldLabel: string) => {
    if (!raw.trim()) return {};
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        emitToast({
          title: texts.formInvalidJsonTitle,
          description: texts.formInvalidJsonDesc.replace("{field}", fieldLabel),
        });
        return null;
      }
      return parsed;
    } catch {
      emitToast({
        title: texts.formInvalidJsonTitle,
        description: texts.formInvalidJsonDesc.replace("{field}", fieldLabel),
      });
      return null;
    }
  };

  const formatPreviewValue = (value: any) => {
    if (value === undefined || value === null || value === "") {
      return texts.previewEmptyValue;
    }
    if (Array.isArray(value)) {
      if (value.length === 0) return texts.previewEmptyValue;
      return value.join(", ");
    }
    if (typeof value === "object") {
      try {
        const text = JSON.stringify(value);
        return text.length > 160 ? `${text.slice(0, 160)}...` : text;
      } catch {
        return String(value);
      }
    }
    return String(value);
  };

  const formatTestError = (error: any) => {
    if (!error) return texts.testConnectionFailFallback;
    const code = String(error);
    if (code === "timeout") return texts.testConnectionTimeout;
    if (code === "request_failed") return texts.testConnectionFailFallback;
    return code;
  };

  const countObjectKeys = (value: any) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    return Object.keys(value).length;
  };

  const buildPreviewRows = (data: any) => {
    if (!data || typeof data !== "object") return [];
    if (kind === "api") {
      const apiType = String(data.type || "openai_compat");
      const members =
        Array.isArray(data.members) && data.members.length
          ? data.members.length
          : 0;
      return [
        { label: texts.previewFields.type, value: apiType },
        {
          label: texts.previewFields.baseUrl,
          value: data.base_url || data.baseUrl || "-",
        },
        { label: texts.previewFields.model, value: data.model || "-" },
        { label: texts.previewFields.timeout, value: data.timeout ?? "-" },
        { label: texts.previewFields.group, value: data.provider_group || "-" },
        {
          label: texts.previewFields.members,
          value: apiType === "pool" ? String(members) : texts.previewEmptyValue,
        },
        {
          label: texts.previewFields.headers,
          value: countObjectKeys(data.headers),
        },
        {
          label: texts.previewFields.params,
          value: countObjectKeys(data.params),
        },
      ];
    }
    if (kind === "pipeline") {
      return [
        { label: texts.previewFields.provider, value: data.provider },
        { label: texts.previewFields.prompt, value: data.prompt },
        { label: texts.previewFields.parser, value: data.parser },
        { label: texts.previewFields.linePolicy, value: data.line_policy },
        { label: texts.previewFields.chunkPolicy, value: data.chunk_policy },
        {
          label: texts.previewFields.applyLinePolicy,
          value: String(!!data.apply_line_policy),
        },
        {
          label: texts.previewFields.settings,
          value: formatPreviewValue(data.settings || {}),
        },
      ];
    }
    if (kind === "prompt") {
      const systemTemplate = String(data.system_template || "");
      const userTemplate = String(data.user_template || "");
      return [
        {
          label: texts.previewFields.systemTemplate,
          value: systemTemplate ? `${systemTemplate.length}` : texts.previewEmptyValue,
        },
        {
          label: texts.previewFields.userTemplate,
          value: userTemplate ? `${userTemplate.length}` : texts.previewEmptyValue,
        },
        {
          label: texts.previewFields.context,
          value: formatPreviewValue(data.context || {}),
        },
      ];
    }
    if (kind === "parser") {
      return [
        { label: texts.previewFields.parserType, value: data.type },
        { label: texts.previewFields.options, value: formatPreviewValue(data.options || {}) },
      ];
    }
    if (kind === "policy") {
      return [
        { label: texts.previewFields.policyType, value: data.type },
        { label: texts.previewFields.options, value: formatPreviewValue(data.options || {}) },
      ];
    }
    if (kind === "chunk") {
      return [
        { label: texts.previewFields.chunkType, value: data.chunk_type },
        { label: texts.previewFields.options, value: formatPreviewValue(data.options || {}) },
      ];
    }
    return [];
  };

  const buildApiPayload = (): Record<string, any> | null => {
    const id = apiForm.id.trim();
    const baseUrl = apiForm.baseUrl.trim();
    const model = apiForm.model.trim();
    const apiType = apiForm.apiType || "openai_compat";
    if (!id) return null;
    if (apiType === "openai_compat" && (!baseUrl || !model)) return null;
    const members = apiForm.members
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
    if (apiType === "pool" && members.length === 0) return null;

    const headers = parseJsonField(apiForm.headers, texts.formFields.headersLabel);
    if (headers === null) return null;
    const params = parseJsonField(apiForm.params, texts.formFields.paramsLabel);
    if (params === null) return null;

    const payload: Record<string, any> = {
      id,
      name: apiForm.name.trim() || id,
      type: apiType,
      headers,
      params,
    };
    if (apiType === "openai_compat") {
      payload.base_url = baseUrl;
      payload.api_key = apiForm.apiKey.trim();
      payload.model = model;
    }
    if (apiType === "pool") {
      payload.members = members;
    }
    const timeoutValue = Number(apiForm.timeout);
    if (Number.isFinite(timeoutValue) && timeoutValue > 0) {
      payload.timeout = timeoutValue;
    }
    if (activeGroup && activeGroup !== "custom") {
      payload.provider_group = activeGroup;
    }
    return payload;
  };

  const buildYamlFromPayload = (payload: Record<string, any>) =>
    yaml.dump(payload, { lineWidth: 120, noRefs: true });

  const syncComposerFromPipelineData = (data: any) => {
    if (!data || typeof data !== "object") return;
    setPipelineComposer({
      id: String(data.id ?? ""),
      name: String(data.name ?? ""),
      provider: String(data.provider ?? ""),
      prompt: String(data.prompt ?? ""),
      parser: String(data.parser ?? ""),
      linePolicy: String(data.line_policy ?? ""),
      chunkPolicy: String(data.chunk_policy ?? ""),
      applyLinePolicy: Boolean(data.apply_line_policy),
      temperature:
        data.settings?.temperature !== undefined && data.settings?.temperature !== null
          ? String(data.settings.temperature)
          : "",
      maxRetries:
        data.settings?.max_retries !== undefined && data.settings?.max_retries !== null
          ? String(data.settings.max_retries)
          : "",
    });
  };

  const buildPipelinePayload = (): Record<string, any> | null => {
    const id = pipelineComposer.id.trim();
    if (!id) return null;
    const name = pipelineComposer.name.trim() || id;
    const provider = pipelineComposer.provider.trim();
    const prompt = pipelineComposer.prompt.trim();
    const parser = pipelineComposer.parser.trim();
    const linePolicy = pipelineComposer.linePolicy.trim();
    const chunkPolicy = pipelineComposer.chunkPolicy.trim();
    if (!provider || !prompt || !parser || !chunkPolicy) return null;
    if (pipelineComposer.applyLinePolicy && !linePolicy) return null;

    const payload: Record<string, any> = {
      id,
      name,
      provider,
      prompt,
      parser,
      line_policy: linePolicy,
      chunk_policy: chunkPolicy,
      apply_line_policy: pipelineComposer.applyLinePolicy,
    };
    const settings: Record<string, any> = {};
    const tempValue = Number(pipelineComposer.temperature);
    if (Number.isFinite(tempValue)) settings.temperature = tempValue;
    const retryValue = Number(pipelineComposer.maxRetries);
    if (Number.isFinite(retryValue)) settings.max_retries = retryValue;
    if (Object.keys(settings).length) payload.settings = settings;
    return payload;
  };

  const syncApiFormFromData = (data: any) => {
    if (!data || typeof data !== "object") return;
    const headers =
      data.headers && typeof data.headers === "object" && !Array.isArray(data.headers)
        ? JSON.stringify(data.headers, null, 2)
        : "";
    const params =
      data.params && typeof data.params === "object" && !Array.isArray(data.params)
        ? JSON.stringify(data.params, null, 2)
        : "";
    setApiForm({
      id: String(data.id ?? ""),
      name: String(data.name ?? ""),
      apiType: (data.type as "openai_compat" | "pool") || "openai_compat",
      baseUrl: String(data.base_url ?? data.baseUrl ?? ""),
      apiKey: String(data.api_key ?? data.apiKey ?? ""),
      model: String(data.model ?? ""),
      members: Array.isArray(data.members) ? data.members.join("\n") : "",
      headers,
      params,
      timeout:
        data.timeout !== undefined && data.timeout !== null
          ? String(data.timeout)
          : "",
    });
  };

  const loadProfiles = async (targetKind: ProfileKind) => {
    try {
      const list = await window.api?.pipelineV2ProfilesList?.(targetKind);
      if (Array.isArray(list)) {
        setProfiles(list.map((item) => ({ id: item.id, name: item.name })));
        if (targetKind === "api") {
          const details = await Promise.all(
            list.map(async (item) => {
              const detail = await window.api?.pipelineV2ProfilesLoad?.("api", item.id);
              const data = detail?.data;
              return {
                id: item.id,
                name: item.name,
                data,
                group: inferGroup(data, item.id, item.name),
              } as ApiProfileDetail;
            }),
          );
          setApiProfiles(details);
        }
        return;
      }
    } catch {
      await refreshPipelineStatus();
    }
    setProfiles([]);
    if (targetKind === "api") setApiProfiles([]);
  };

  const loadProfileIndex = async () => {
    const nextIndex: Record<ProfileKind, string[]> = {
      api: [],
      pipeline: [],
      prompt: [],
      parser: [],
      policy: [],
      chunk: [],
    };
    const pipelines: { id: string; name: string }[] = [];
    try {
      for (const targetKind of PROFILE_KINDS) {
        const list = await window.api?.pipelineV2ProfilesList?.(targetKind);
        if (Array.isArray(list)) {
          nextIndex[targetKind] = list.map((item) => item.id);
          if (targetKind === "pipeline") {
            pipelines.push(...list.map((item) => ({ id: item.id, name: item.name })));
          }
        }
      }
    } catch {
      await refreshPipelineStatus();
    }
    setProfileIndex(nextIndex);
    setPipelineList(pipelines);
  };

  const loadProfile = async (targetKind: ProfileKind, id: string) => {
    try {
      const data = await window.api?.pipelineV2ProfilesLoad?.(targetKind, id);
      if (data?.yaml) {
        setYamlText(data.yaml);
        setSelectedId(id);
        if (targetKind === "api") {
          if (data?.data) {
            syncApiFormFromData(data.data);
            setActiveGroup(inferGroup(data.data, id, data.name || ""));
          } else {
            try {
              const parsed = yaml.load(data.yaml) as any;
              syncApiFormFromData(parsed);
              setActiveGroup(inferGroup(parsed, id, data.name || ""));
            } catch {
              // ignore parse errors
            }
          }
        }
        return;
      }
    } catch {
      await refreshPipelineStatus();
    }
  };

  const saveProfileWithYaml = async (
    targetKind: ProfileKind,
    sourceYaml: string,
    parsedData?: any,
  ) => {
    if (!sourceYaml.trim()) {
      emitToast({ title: texts.saveFail, description: texts.emptyYaml });
      return;
    }
    try {
      const parsed = parsedData ?? (yaml.load(sourceYaml) as any);
      const id = parsed?.id || selectedId;
      if (!id) {
        emitToast({ title: texts.saveFail, description: texts.missingId });
        return;
      }
      const validation = validateProfile(targetKind, parsed, profileIndex, texts);
      const isLocalMode = pipelineStatus?.mode === "local";
      if (validation.errors.length) {
        if (!isLocalMode) {
          emitToast({
            title: texts.validationError,
            description: validation.errors.join("\n"),
          });
          return;
        }
        emitToast({
          title: texts.validationWarn,
          description: validation.errors.join("\n"),
        });
      }
      if (validation.warnings.length) {
        emitToast({
          title: texts.validationWarn,
          description: validation.warnings.join("\n"),
        });
      }
      const result = await window.api?.pipelineV2ProfilesSave?.(targetKind, id, sourceYaml);
      if (result?.ok) {
        emitToast({ title: texts.saveOk, description: `${texts.kinds[targetKind]}: ${id}` });
        await loadProfiles(targetKind);
        await loadProfileIndex();
        setSelectedId(id);
        if (Array.isArray(result?.warnings) && result.warnings.length) {
          emitToast({
            title: texts.validationWarn,
            description: result.warnings
              .map((code: string) => formatErrorCode(code, texts))
              .join("\n"),
          });
        }
      } else {
        emitToast({
          title: texts.saveFail,
          description: formatServerError(result?.error, texts.unknownError, texts),
        });
      }
    } catch (e: any) {
      await refreshPipelineStatus();
      emitToast({ title: texts.saveFail, description: e?.message || texts.unknownError });
    }
  };

  const handleSave = async () => {
    await saveProfileWithYaml(kind, yamlText);
  };

  const hasMissingRequired = () => {
    const id = apiForm.id.trim();
    if (!id) return true;
    if (apiForm.apiType === "pool") {
      return (
        apiForm.members
          .split(/\r?\n/)
          .map((item) => item.trim())
          .filter(Boolean).length === 0
      );
    }
    return !apiForm.baseUrl.trim() || !apiForm.model.trim();
  };

  const handleSaveForm = async () => {
    const payload = buildApiPayload();
    if (!payload) {
      if (hasMissingRequired()) {
        emitToast({ title: texts.saveFail, description: texts.formMissing });
      }
      return;
    }
    const nextYaml = buildYamlFromPayload(payload);
    setYamlText(nextYaml);
    await saveProfileWithYaml("api", nextYaml, payload);
  };

  const handleApplyFormToYaml = () => {
    const payload = buildApiPayload();
    if (!payload) {
      if (hasMissingRequired()) {
        emitToast({ title: texts.saveFail, description: texts.formMissing });
      }
      return;
    }
    setYamlText(buildYamlFromPayload(payload));
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    await window.api?.pipelineV2ProfilesDelete?.(kind, selectedId);
    emitToast({ title: texts.deleteOk, description: selectedId });
    setSelectedId(null);
    setYamlText("");
    await loadProfiles(kind);
    await loadProfileIndex();
  };

  const handleRun = async () => {
    if (!runFilePath || !runPipeline || !profilesDir) {
      emitToast({ title: texts.runFail, description: texts.runMissing });
      return;
    }
    const pipelineData =
      runPipelineData ||
      (await window.api?.pipelineV2ProfilesLoad?.("pipeline", runPipeline))?.data;
    if (!pipelineData) {
      emitToast({ title: texts.runFail, description: texts.pipelineNotFound });
      return;
    }
    const validation = validateProfile("pipeline", pipelineData, profileIndex, texts);
    if (validation.errors.length) {
      emitToast({
        title: texts.validationError,
        description: validation.errors.join("\n"),
      });
      return;
    }
    setIsRunning(true);
    setLogs([]);
    const result = await window.api?.pipelineV2Run?.({
      filePath: runFilePath,
      pipelineId: runPipeline,
      profilesDir,
    });
    setIsRunning(false);
    if (result?.ok) {
      emitToast({ title: texts.runOk, description: result.runId });
    } else {
      emitToast({ title: texts.runFail, description: `${result?.code ?? ""}` });
    }
  };

  const handleNewProfile = () => {
    setSelectedId(null);
    setYamlText(DEFAULT_TEMPLATES[kind]);
  };

  const handleNewApiProfile = (groupKey?: string, preset?: ApiPreset) => {
    setSelectedId(null);
    setActiveGroup(groupKey || null);
    if (preset) setActivePreset(preset.key);
    setApiForm((prev) => ({
      ...prev,
      id: preset?.defaultId || "",
      name: preset?.defaultId || "",
      apiType: "openai_compat",
      baseUrl: preset?.baseUrl || "",
      model: preset?.model || "",
      apiKey: "",
      members: "",
      headers: "",
      params: "",
      timeout: prev.timeout || "600",
    }));
  };

  const handleApplyPreset = (preset: ApiPreset) => {
    setActivePreset(preset.key);
    if (groupLabels[preset.key]) {
      setActiveGroup(preset.key);
    }
    setApiForm((prev) => ({
      ...prev,
      apiType: "openai_compat",
      id: prev.id || preset.defaultId,
      name: prev.name || preset.defaultId,
      baseUrl: preset.baseUrl || prev.baseUrl,
      model: preset.model || prev.model,
    }));
  };

  const handleApplyTemplate = (template: TemplateDefinition) => {
    setSelectedId(null);
    setYamlText(template.yaml);
    try {
      const parsed = yaml.load(template.yaml) as any;
      if (template.kind === "api") {
        syncApiFormFromData(parsed);
        setActiveGroup(inferGroup(parsed, parsed?.id || "", parsed?.name || ""));
      }
      if (template.kind === "pipeline") {
        syncComposerFromPipelineData(parsed);
      }
    } catch {
      // ignore parse errors
    }
  };

  const handleTestConnection = async () => {
    if (isPoolType) {
      emitToast({ title: texts.saveFail, description: texts.testConnectionPoolHint });
      return;
    }
    const baseUrl = apiForm.baseUrl.trim();
    if (!baseUrl) {
      emitToast({ title: texts.saveFail, description: texts.formMissing });
      return;
    }
    const apiKey =
      apiForm.apiKey
        .split(/\r?\n/)
        .map((item) => item.trim())
        .find(Boolean) || "";
    const timeoutValue = Number(apiForm.timeout);
    const timeoutMs =
      Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue * 1000 : 8000;
    setApiTest({ status: "testing" });
    const result = await window.api?.pipelineV2ApiTest?.({
      baseUrl,
      apiKey,
      timeoutMs,
    });
    if (result?.ok) {
      setApiTest({
        status: "success",
        latencyMs: result.latencyMs,
        statusCode: result.status,
        url: result.url,
      });
    } else {
      setApiTest({
        status: "error",
        message: formatTestError(result?.message),
        url: result?.url,
      });
    }
  };

  const refreshPipelineStatus = async () => {
    const status = await window.api?.pipelineV2Status?.();
    if (status) setPipelineStatus(status);
  };

  const handleRetryPipelineServer = async () => {
    setStatusBusy(true);
    const status = await window.api?.pipelineV2Retry?.();
    if (status) setPipelineStatus(status);
    await loadProfiles(kind);
    await loadProfileIndex();
    setStatusBusy(false);
  };

  useEffect(() => {
    const bootstrap = async () => {
      await refreshPipelineStatus();
      try {
        const dir = await window.api?.pipelineV2ProfilesPath?.();
        if (dir) setProfilesDir(dir);
      } catch {
        await refreshPipelineStatus();
      }
      await loadProfiles(kind);
      await loadProfileIndex();
    };
    bootstrap();
  }, []);

  useEffect(() => {
    loadProfiles(kind);
    setSelectedId(null);
    setYamlText("");
  }, [kind]);

  useEffect(() => {
    if (viewMode === "api" && kind !== "api") {
      setKind("api");
    }
  }, [viewMode, kind]);

  useEffect(() => {
    setApiTest({ status: "idle" });
  }, [apiForm.baseUrl, apiForm.apiKey, apiForm.apiType]);

  useEffect(() => {
    if (kind !== "pipeline") return;
    if (!parsedResult.data) return;
    syncComposerFromPipelineData(parsedResult.data);
  }, [kind, selectedId]);

  useEffect(() => {
    const syncPipeline = async () => {
      if (!runPipeline) {
        setRunPipelineData(null);
        return;
      }
      try {
        const data = await window.api?.pipelineV2ProfilesLoad?.(
          "pipeline",
          runPipeline,
        );
        if (data?.data) {
          setRunPipelineData(data.data);
        } else {
          setRunPipelineData(null);
        }
      } catch {
        await refreshPipelineStatus();
        setRunPipelineData(null);
      }
    };
    syncPipeline();
  }, [runPipeline]);

  useEffect(() => {
    const unsub = window.api?.onPipelineV2Log?.((payload: any) => {
      if (!payload?.message) return;
      setLogs((prev) => [...prev, payload.message]);
    });
    return () => {
      if (unsub) unsub();
    };
  }, []);

  const isPoolType = apiForm.apiType === "pool";

  const renderPresetGrid = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-3">
      {presets.map((preset) => (
        <button
          key={preset.key}
          onClick={() => handleApplyPreset(preset)}
          className={cn(
            "group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm transition-all",
            activePreset === preset.key
              ? "bg-gradient-to-br from-primary/20 via-primary/10 to-transparent border-primary/40 text-foreground shadow-md"
              : "bg-background/70 border-border/60 text-foreground hover:border-primary/30 hover:shadow-sm",
          )}
        >
          <div className="flex flex-col items-start gap-0.5 text-left">
            <span className="truncate font-medium">{preset.label}</span>
            <span className="text-[11px] text-muted-foreground">
              {preset.baseUrl && preset.model
                ? texts.presetApplyHint
                : texts.presetNeedsConfig}
            </span>
          </div>
          <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-foreground" />
        </button>
      ))}
    </div>
  );

  const renderStatusBanner = () => {
    if (!pipelineStatus) return null;
    const isLocal = pipelineStatus.mode === "local";
    const statusLabel = isLocal ? texts.status.localLabel : texts.status.serverLabel;
    const statusDesc = isLocal ? texts.status.localDesc : texts.status.serverDesc;
    return (
      <Card
        className={cn(
          "mt-6 border border-border/60",
          isLocal
            ? "bg-destructive/10 border-destructive/20"
            : "bg-primary/10 border-primary/20",
        )}
      >
        <CardContent className="pt-3 pb-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                {texts.status.title}
              </div>
              <div
                className={cn(
                  "text-sm font-semibold",
                  isLocal ? "text-destructive" : "text-primary",
                )}
              >
                {statusLabel}
              </div>
              <div className="text-xs text-muted-foreground">{statusDesc}</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRetryPipelineServer}
                disabled={statusBusy}
              >
                {statusBusy ? texts.status.actionRetrying : texts.status.actionRetry}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowStatusDetail((prev) => !prev)}
              >
                {showStatusDetail ? texts.status.actionHide : texts.status.actionDetails}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => profilesDir && window.api?.openFolder?.(profilesDir)}
                disabled={!profilesDir}
              >
                {texts.status.actionOpenDir}
              </Button>
            </div>
          </div>
          {showStatusDetail && (
            <div className="rounded-lg border border-border/60 bg-background/60 p-3 text-xs space-y-2">
              <div className="font-semibold">{texts.status.detailTitle}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="text-muted-foreground">{texts.status.detailError}</div>
                <div>{pipelineStatus.error || texts.status.detailUnknown}</div>
                <div className="text-muted-foreground">{texts.status.detailMessage}</div>
                <div className="break-words">
                  {pipelineStatus.detail || texts.status.detailUnknown}
                </div>
              </div>
              <div className="text-muted-foreground">{texts.status.detailHint}</div>
            </div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderGroupCard = (groupKey: string, accent: string) => {
    const group = groupLabels[groupKey] ?? {
      title: groupKey,
      desc: "",
      selectPlaceholder: "",
    };
    const list = groupProfiles[groupKey] || [];
    const selected = list.find((item) => item.id === selectedId);
    return (
      <Card key={groupKey} className="relative overflow-hidden border-border/60 bg-background/70">
        <div className={cn("absolute inset-y-0 left-0 w-1.5", accent)} />
        <div className="absolute -right-10 -top-10 h-24 w-24 rounded-full bg-secondary/40 blur-2xl" />
        <CardContent className="pt-5 space-y-3 relative">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div>
                <div className="text-sm font-semibold">{group?.title}</div>
                <div className="text-xs text-muted-foreground">{group?.desc}</div>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                handleNewApiProfile(
                  groupKey,
                  API_PRESETS.find((preset) => preset.key === groupKey),
                )
              }
            >
              <Plus className="w-4 h-4 mr-1.5" />
              {texts.add}
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground">
            {texts.groupCount.replace("{count}", String(list.length))}
          </div>
          <select
            className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
            value={selected?.id || ""}
            onChange={(event) => {
              const value = event.target.value;
              if (!value) return;
              setActiveGroup(groupKey);
              loadProfile("api", value);
            }}
          >
            <option value="">{group?.selectPlaceholder}</option>
            {list.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name} ({profile.id})
              </option>
            ))}
          </select>
          {list.length === 0 && (
            <div className="text-[11px] text-muted-foreground">{texts.groupEmptyList}</div>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderTemplateGallery = () => (
    <Card className="border-border/60 bg-background/70">
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{texts.templates.title}</div>
            <p className="text-xs text-muted-foreground">{texts.templates.desc}</p>
          </div>
          <div className="inline-flex items-center gap-1.5 text-xs text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
            <Wand2 className="w-3.5 h-3.5" />
            {texts.templates.badge}
          </div>
        </div>
        {templatesForKind.length === 0 ? (
          <div className="text-xs text-muted-foreground">{texts.templates.empty}</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {templatesForKind.map((template) => {
              const item = texts.templateItems[template.key] || {
                title: template.key,
                desc: "",
              };
              return (
                <div
                  key={template.key}
                  className="rounded-xl border border-border/60 bg-background/80 p-4 space-y-2 shadow-sm"
                >
                  <div className="text-sm font-semibold">{item.title}</div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleApplyTemplate(template)}
                  >
                    {texts.templates.apply}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );

  const renderPreviewPanel = () => {
    if (!yamlText.trim()) {
      return (
        <div className="text-xs text-muted-foreground">{texts.previewEmpty}</div>
      );
    }
    if (parsedResult.error) {
      return (
        <div className="text-xs text-destructive">{texts.previewInvalid}</div>
      );
    }
    const rows = buildPreviewRows(parsedResult.data);
    if (rows.length === 0) {
      return (
        <div className="text-xs text-muted-foreground">{texts.previewEmpty}</div>
      );
    }
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/70 px-3 py-2"
          >
            <span className="text-muted-foreground">{row.label}</span>
            <span className="font-medium text-foreground text-right">
              {formatPreviewValue(row.value)}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const renderValidationPanel = () => {
    if (!yamlText.trim()) {
      return (
        <div className="text-xs text-muted-foreground">{texts.validationPanelEmpty}</div>
      );
    }
    if (parsedResult.error) {
      return (
        <div className="text-xs text-destructive">{texts.validationPanelInvalid}</div>
      );
    }
    if (!validationResult) {
      return (
        <div className="text-xs text-muted-foreground">{texts.validationPanelEmpty}</div>
      );
    }
    if (validationResult.errors.length === 0 && validationResult.warnings.length === 0) {
      return (
        <div className="flex items-center gap-2 text-xs text-emerald-600">
          <CheckCircle2 className="w-4 h-4" />
          {texts.validationPanelOk}
        </div>
      );
    }
    return (
      <div className="space-y-3 text-xs">
        {validationResult.errors.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-semibold">{texts.validationPanelErrors}</span>
            </div>
            <ul className="list-disc list-inside text-destructive">
              {validationResult.errors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {validationResult.warnings.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle className="w-4 h-4" />
              <span className="font-semibold">{texts.validationPanelWarnings}</span>
            </div>
            <ul className="list-disc list-inside text-amber-600">
              {validationResult.warnings.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  };

  const renderPipelineComposer = () => {
    if (kind !== "pipeline") return null;

    return (
      <Card className="border-border/60 bg-background/80">
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{texts.composer.title}</div>
              <p className="text-xs text-muted-foreground">{texts.composer.desc}</p>
            </div>
            <div className="inline-flex items-center gap-1.5 text-xs text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
              <Boxes className="w-3.5 h-3.5" />
              {texts.composer.badge}
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              {texts.composer.mapTitle}
            </div>
            <PipelineGraphView
              nodes={pipelineGraphNodes}
              actions={texts.composer.graphActions}
              dragHint={texts.composer.graphHint}
            />
            <div className="text-[11px] text-muted-foreground">
              {texts.composer.mapHint}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="space-y-2">
              <Label>{texts.composer.fields.idLabel}</Label>
              <Input
                value={pipelineComposer.id}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, id: e.target.value }))
                }
                placeholder={texts.composer.placeholders.id}
              />
            </div>
            <div className="space-y-2">
              <Label>{texts.composer.fields.nameLabel}</Label>
              <Input
                value={pipelineComposer.name}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, name: e.target.value }))
                }
                placeholder={texts.composer.placeholders.name}
              />
            </div>
            <div className="space-y-2">
              <Label>{texts.composer.fields.providerLabel}</Label>
              <select
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                value={pipelineComposer.provider}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, provider: e.target.value }))
                }
              >
                <option value="">{texts.composer.placeholders.provider}</option>
                {profileIndex.api.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{texts.composer.fields.promptLabel}</Label>
              <select
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                value={pipelineComposer.prompt}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, prompt: e.target.value }))
                }
              >
                <option value="">{texts.composer.placeholders.prompt}</option>
                {profileIndex.prompt.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{texts.composer.fields.parserLabel}</Label>
              <select
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                value={pipelineComposer.parser}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, parser: e.target.value }))
                }
              >
                <option value="">{texts.composer.placeholders.parser}</option>
                {profileIndex.parser.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{texts.composer.fields.linePolicyLabel}</Label>
              <select
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                value={pipelineComposer.linePolicy}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, linePolicy: e.target.value }))
                }
              >
                <option value="">{texts.composer.placeholders.linePolicy}</option>
                {profileIndex.policy.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>{texts.composer.fields.chunkPolicyLabel}</Label>
              <select
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                value={pipelineComposer.chunkPolicy}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, chunkPolicy: e.target.value }))
                }
              >
                <option value="">{texts.composer.placeholders.chunkPolicy}</option>
                {profileIndex.chunk.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{texts.composer.fields.temperatureLabel}</Label>
              <Input
                value={pipelineComposer.temperature}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, temperature: e.target.value }))
                }
                placeholder={texts.composer.placeholders.temperature}
              />
            </div>
            <div className="space-y-2">
              <Label>{texts.composer.fields.maxRetriesLabel}</Label>
              <Input
                value={pipelineComposer.maxRetries}
                onChange={(e) =>
                  setPipelineComposer((prev) => ({ ...prev, maxRetries: e.target.value }))
                }
                placeholder={texts.composer.placeholders.maxRetries}
              />
            </div>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <input
              id="pipeline-apply-line-policy"
              type="checkbox"
              checked={pipelineComposer.applyLinePolicy}
              onChange={(e) =>
                setPipelineComposer((prev) => ({
                  ...prev,
                  applyLinePolicy: e.target.checked,
                }))
              }
            />
            <label htmlFor="pipeline-apply-line-policy">
              {texts.composer.fields.applyLinePolicyLabel}
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                if (parsedResult.data) syncComposerFromPipelineData(parsedResult.data);
              }}
            >
              {texts.composer.sync}
            </Button>
            <Button
              onClick={() => {
                const payload = buildPipelinePayload();
                if (!payload) {
                  emitToast({
                    title: texts.saveFail,
                    description: texts.composer.missing,
                  });
                  return;
                }
                setYamlText(buildYamlFromPayload(payload));
              }}
            >
              {texts.composer.apply}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">{texts.composer.hint}</div>
        </CardContent>
      </Card>
    );
  };

  const renderApiView = () => {
    const statusText =
      apiTest.status === "success"
        ? texts.testConnectionOk
            .replace("{latency}", String(apiTest.latencyMs ?? "-"))
            .replace("{status}", String(apiTest.statusCode ?? "-"))
        : apiTest.status === "error"
          ? texts.testConnectionFail.replace(
              "{error}",
              apiTest.message || texts.testConnectionFailFallback,
            )
          : texts.testConnectionRunning;

    return (
      <>
      <Card className="relative overflow-hidden border-border/60 bg-gradient-to-br from-background via-background to-secondary/30">
        <CardContent className="pt-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-sm font-semibold">{texts.formTitle}</div>
                <p className="text-xs text-muted-foreground">{texts.formDesc}</p>
              </div>
              <div className="inline-flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
                <Sparkles className="w-3.5 h-3.5" />
                {texts.formBadge}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="space-y-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {texts.formSectionMain}
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.nameLabel}</Label>
                  <Input
                    value={apiForm.name}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, name: e.target.value }))
                    }
                    placeholder={texts.formPlaceholders.name}
                  />
                  <div className="text-[11px] text-muted-foreground">{texts.formHints.name}</div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.idLabel}</Label>
                  <Input
                    value={apiForm.id}
                    onChange={(e) => setApiForm((prev) => ({ ...prev, id: e.target.value }))}
                    placeholder={texts.formPlaceholders.id}
                  />
                  <div className="text-[11px] text-muted-foreground">{texts.formHints.id}</div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.baseUrlLabel}</Label>
                  <Input
                    value={apiForm.baseUrl}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, baseUrl: e.target.value }))
                    }
                    placeholder={texts.formPlaceholders.baseUrl}
                    disabled={isPoolType}
                  />
                  <div className="text-[11px] text-muted-foreground">{texts.formHints.baseUrl}</div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.apiKeyLabel}</Label>
                  <textarea
                    className={cn(
                      "w-full min-h-[120px] p-3 rounded-lg border bg-secondary/10 text-sm font-mono",
                      isPoolType && "opacity-60",
                    )}
                    value={apiForm.apiKey}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, apiKey: e.target.value }))
                    }
                    placeholder={texts.formPlaceholders.apiKey}
                    disabled={isPoolType}
                  />
                  <div className="text-[11px] text-muted-foreground">{texts.formHints.apiKey}</div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.modelLabel}</Label>
                  <Input
                    value={apiForm.model}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, model: e.target.value }))
                    }
                    placeholder={texts.formPlaceholders.model}
                    disabled={isPoolType}
                  />
                  <div className="text-[11px] text-muted-foreground">{texts.formHints.model}</div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {texts.formSectionAdvanced}
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.apiTypeLabel}</Label>
                  <select
                    className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                    value={apiForm.apiType}
                    onChange={(event) =>
                      setApiForm((prev) => ({
                        ...prev,
                        apiType: event.target.value as "openai_compat" | "pool",
                      }))
                    }
                  >
                    <option value="openai_compat">{texts.apiTypeOptions.openai}</option>
                    <option value="pool">{texts.apiTypeOptions.pool}</option>
                  </select>
                  <div className="text-[11px] text-muted-foreground">
                    {apiForm.apiType === "pool"
                      ? texts.apiTypeHints.pool
                      : texts.apiTypeHints.openai}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.groupLabel}</Label>
                  <select
                    className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                    value={activeGroup || "custom"}
                    onChange={(event) => {
                      const value = event.target.value;
                      setActiveGroup(value === "custom" ? null : value);
                    }}
                  >
                    <option value="custom">{texts.groupCustom}</option>
                    {CUSTOM_GROUPS.map((group) => (
                      <option key={group.key} value={group.key}>
                        {groupLabels[group.key]?.title || group.key}
                      </option>
                    ))}
                  </select>
                  <div className="text-[11px] text-muted-foreground">{texts.formHints.group}</div>
                </div>
                {isPoolType && (
                  <div className="space-y-2">
                    <Label>{texts.formFields.membersLabel}</Label>
                    <textarea
                      className="w-full min-h-[90px] p-3 rounded-lg border bg-secondary/10 text-sm font-mono"
                      value={apiForm.members}
                      onChange={(e) =>
                        setApiForm((prev) => ({ ...prev, members: e.target.value }))
                      }
                      placeholder={texts.formPlaceholders.members}
                    />
                    <div className="text-[11px] text-muted-foreground">
                      {texts.formHints.members}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <Label>{texts.formFields.timeoutLabel}</Label>
                  <Input
                    value={apiForm.timeout}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, timeout: e.target.value }))
                    }
                    placeholder={texts.formPlaceholders.timeout}
                  />
                  <div className="text-[11px] text-muted-foreground">{texts.formHints.timeout}</div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.headersLabel}</Label>
                  <textarea
                    className="w-full min-h-[90px] p-3 rounded-lg border bg-secondary/10 text-sm font-mono"
                    value={apiForm.headers}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, headers: e.target.value }))
                    }
                    placeholder={texts.formPlaceholders.headers}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {texts.formHints.headers}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{texts.formFields.paramsLabel}</Label>
                  <textarea
                    className="w-full min-h-[90px] p-3 rounded-lg border bg-secondary/10 text-sm font-mono"
                    value={apiForm.params}
                    onChange={(e) =>
                      setApiForm((prev) => ({ ...prev, params: e.target.value }))
                    }
                    placeholder={texts.formPlaceholders.params}
                  />
                  <div className="text-[11px] text-muted-foreground">
                    {texts.formHints.params}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={handleSaveForm}>
                <Save className="w-4 h-4 mr-1.5" />
                {texts.formSave}
              </Button>
              <Button variant="outline" onClick={handleApplyFormToYaml}>
                {texts.formApply}
              </Button>
              <Button
                variant="outline"
                onClick={handleTestConnection}
                disabled={isPoolType || !apiForm.baseUrl.trim() || apiTest.status === "testing"}
              >
                <Activity className="w-4 h-4 mr-1.5" />
                {apiTest.status === "testing"
                  ? texts.testConnectionRunning
                  : texts.testConnection}
              </Button>
              <Button variant="ghost" onClick={() => setApiForm(DEFAULT_API_FORM)}>
                {texts.formReset}
              </Button>
              <Button
                variant="outline"
                onClick={handleDelete}
                disabled={!selectedId}
                className="ml-auto"
              >
                <Trash2 className="w-4 h-4 mr-1.5" />
                {texts.delete}
              </Button>
            </div>
            {apiTest.status !== "idle" && (
              <div
                className={cn(
                  "text-xs",
                  apiTest.status === "success"
                    ? "text-emerald-600"
                    : apiTest.status === "error"
                      ? "text-destructive"
                      : "text-muted-foreground",
                )}
              >
                {statusText}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
            {isPoolType ? texts.testConnectionPoolHint : texts.testConnectionHint}
            </div>
            <div className="text-xs text-muted-foreground">{texts.formHint}</div>
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-background/70">
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{texts.presetTitle}</div>
              <p className="text-xs text-muted-foreground">{texts.presetDesc}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-xs text-primary bg-primary/10 border border-primary/20 rounded-full px-2 py-1">
                <Sparkles className="w-3.5 h-3.5" />
                {texts.presetBadge}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowPresets((prev) => !prev)}
              >
                {showPresets ? texts.presetToggleHide : texts.presetToggleShow}
              </Button>
            </div>
          </div>
          {showPresets ? (
            renderPresetGrid()
          ) : (
            <div className="text-xs text-muted-foreground">
              {texts.presetCollapsedHint}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-background/70">
        <CardContent className="pt-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{texts.groupTitle}</div>
              <p className="text-xs text-muted-foreground">{texts.groupDesc}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowGroups((prev) => !prev)}
            >
              {showGroups ? texts.groupToggleHide : texts.groupToggleShow}
            </Button>
          </div>
          {showGroups ? (
            <div className="space-y-4">
              {CUSTOM_GROUPS.map((group) => renderGroupCard(group.key, group.accent))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">
              {texts.groupCollapsedHint}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60 bg-gradient-to-br from-background via-background to-secondary/20">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">{texts.flowTitle}</div>
              <p className="text-xs text-muted-foreground">{texts.flowDesc}</p>
            </div>
            <Button variant="outline" onClick={() => setViewMode("advanced")}> 
              <Boxes className="w-4 h-4 mr-1.5" />
              {texts.flowAction}
            </Button>
          </div>
        </CardContent>
      </Card>
      </>
    );
  };

  const renderAdvancedView = () => (
    <>
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{texts.profileSection}</div>
              <p className="text-xs text-muted-foreground">{profilesDir}</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  loadProfiles(kind);
                  loadProfileIndex();
                }}
              >
                <RefreshCw className="w-4 h-4 mr-1.5" />
                {texts.refresh}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => profilesDir && window.api?.openFolder?.(profilesDir)}
              >
                <FolderOpen className="w-4 h-4 mr-1.5" />
                {texts.openFolder}
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {PROFILE_KINDS.map((k) => (
              <Button
                key={k}
                variant={kind === k ? "default" : "outline"}
                size="sm"
                onClick={() => setKind(k)}
              >
                {texts.kinds[k]}
              </Button>
            ))}
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[0.95fr_1.05fr] gap-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold text-muted-foreground">
                  {texts.profileList}
                </div>
                <Button size="sm" variant="outline" onClick={handleNewProfile}>
                  <Plus className="w-4 h-4 mr-1.5" />
                  {texts.newProfile}
                </Button>
              </div>
              <div className="border rounded-lg divide-y">
                {profiles.length === 0 && (
                  <div className="p-3 text-xs text-muted-foreground">
                    {texts.emptyProfile}
                  </div>
                )}
                {profiles.map((profile) => (
                  <button
                    key={profile.id}
                    onClick={() => loadProfile(kind, profile.id)}
                    className={cn(
                      "w-full text-left p-3 text-sm transition-colors",
                      selectedId === profile.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-secondary",
                    )}
                  >
                    <div className="font-medium">{profile.name}</div>
                    <div className="text-[10px] text-muted-foreground">{profile.id}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-muted-foreground">
                    {texts.editorTitle.replace("{kind}", kindLabel)}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={handleSave}>
                      <Save className="w-4 h-4 mr-1.5" />
                      {texts.save}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleDelete}
                      disabled={!selectedId}
                    >
                      <Trash2 className="w-4 h-4 mr-1.5" />
                      {texts.delete}
                    </Button>
                  </div>
                </div>
                <textarea
                  className="w-full h-[320px] p-3 rounded-lg border bg-secondary/20 text-xs font-mono"
                  value={yamlText}
                  onChange={(e) => setYamlText(e.target.value)}
                  placeholder={texts.editorPlaceholder}
                />
              </div>

              <Card className="border-border/60 bg-background/70">
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Eye className="w-4 h-4 text-primary" />
                    {texts.previewTitle}
                  </div>
                  <p className="text-xs text-muted-foreground">{texts.previewDesc}</p>
                  {renderPreviewPanel()}
                </CardContent>
              </Card>

              {renderPipelineComposer()}

              <Card className="border-border/60 bg-background/70">
                <CardContent className="pt-6 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <CheckCircle2 className="w-4 h-4 text-primary" />
                    {texts.validationPanelTitle}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {texts.validationPanelDesc}
                  </p>
                  {renderValidationPanel()}
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>

      {renderTemplateGallery()}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="text-sm font-semibold">{texts.runSection}</div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{texts.runFile}</Label>
              <div className="flex gap-2">
                <Input
                  value={runFilePath}
                  onChange={(e) => setRunFilePath(e.target.value)}
                  placeholder={texts.runFilePlaceholder}
                />
                <Button
                  variant="outline"
                  onClick={async () => {
                    const result = await window.api?.selectFile?.();
                    if (result) setRunFilePath(result);
                  }}
                >
                  {texts.browse}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{texts.runPipeline}</Label>
              <select
                className="w-full h-10 px-3 rounded-lg border bg-background text-sm"
                value={
                  pipelineList.find((item) => item.id === runPipeline)
                    ? runPipeline
                    : ""
                }
                onChange={(e) => setRunPipeline(e.target.value)}
              >
                <option value="">{texts.runPipelineSelectPlaceholder}</option>
                {pipelineList.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} ({item.id})
                  </option>
                ))}
              </select>
              <Input
                value={runPipeline}
                onChange={(e) => setRunPipeline(e.target.value)}
                placeholder={texts.runPipelinePlaceholder}
              />
              <div className="text-xs text-muted-foreground">{texts.runPipelineManual}</div>
            </div>
          </div>
          <div className="border rounded-lg p-3 bg-secondary/10 text-xs">
            <div className="font-semibold mb-2">{texts.pipelinePreview}</div>
            {runPipelineData ? (
              <div className="grid grid-cols-2 gap-2">
                <div className="text-muted-foreground">{texts.pipelineFieldProvider}</div>
                <div>{runPipelineData.provider || "-"}</div>
                <div className="text-muted-foreground">{texts.pipelineFieldPrompt}</div>
                <div>{runPipelineData.prompt || "-"}</div>
                <div className="text-muted-foreground">{texts.pipelineFieldParser}</div>
                <div>{runPipelineData.parser || "-"}</div>
                <div className="text-muted-foreground">{texts.pipelineFieldLinePolicy}</div>
                <div>{runPipelineData.line_policy || "-"}</div>
                <div className="text-muted-foreground">{texts.pipelineFieldChunkPolicy}</div>
                <div>{runPipelineData.chunk_policy || "-"}</div>
                <div className="text-muted-foreground">{texts.pipelineFieldApplyLine}</div>
                <div>{String(!!runPipelineData.apply_line_policy)}</div>
              </div>
            ) : (
              <div className="text-muted-foreground">{texts.pipelinePreviewEmpty}</div>
            )}
          </div>
          <Button onClick={handleRun} disabled={isRunning}>
            <Play className="w-4 h-4 mr-2" />
            {isRunning ? texts.running : texts.run}
          </Button>
          <div className="border rounded-lg bg-secondary/10 p-3 text-xs whitespace-pre-wrap max-h-48 overflow-auto">
            {logs.length ? logs.join("") : texts.logPlaceholder}
          </div>
        </CardContent>
      </Card>
    </>
  );

  return (
    <div className="relative flex-1 h-full min-h-0 flex flex-col overflow-hidden bg-[radial-gradient(circle_at_top,_hsl(var(--primary)/0.12),_transparent_55%)] font-body">
      <div className="pointer-events-none absolute -top-24 right-10 h-64 w-64 rounded-full bg-[radial-gradient(circle,_hsl(var(--primary)/0.2),_transparent_70%)] blur-3xl animate-float-slow" />
      <div className="pointer-events-none absolute top-1/3 -left-20 h-72 w-72 rounded-full bg-[radial-gradient(circle,_hsl(var(--accent)/0.2),_transparent_70%)] blur-3xl animate-float-slower" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-56 w-56 rounded-full bg-[radial-gradient(circle,_hsl(var(--secondary)/0.3),_transparent_70%)] blur-3xl animate-float-slow" />

      <div className="relative z-10 flex-1 flex flex-col w-full max-w-[1400px] mx-auto min-h-0">
        <div className="px-6 lg:px-8 pt-10 pb-8 shrink-0 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex flex-wrap items-start justify-between gap-6">
            <div className="space-y-3 max-w-2xl">
              <div>
                <h2 className="text-3xl font-semibold tracking-tight text-foreground font-display">
                  {texts.title}
                </h2>
                <p className="text-sm text-muted-foreground mt-2">{texts.subtitle}</p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="inline-flex items-center p-1 rounded-full border border-border/70 bg-background/80 shadow-sm">
                <button
                  onClick={() => setViewMode("api")}
                  className={cn(
                    "px-4 py-2 text-xs font-medium rounded-full transition",
                    viewMode === "api"
                      ? "bg-foreground text-background shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {texts.modeApi}
                </button>
                <button
                  onClick={() => setViewMode("advanced")}
                  className={cn(
                    "px-4 py-2 text-xs font-medium rounded-full transition",
                    viewMode === "advanced"
                      ? "bg-foreground text-background shadow"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {texts.modeAdvanced}
                </button>
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-1">
                <Boxes className="w-4 h-4" />
                {texts.modeLabel}
              </div>
          </div>
        </div>

          {renderStatusBanner()}

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-3">
            {statItems.map((item, index) => (
              <div
                key={item.label}
                className="rounded-xl border border-border/60 bg-background/70 px-4 py-3 shadow-sm backdrop-blur-sm animate-fade-up"
                style={{ animationDelay: `${index * 80}ms` }}
              >
                <div className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  {item.label}
                </div>
                <div className="text-lg font-semibold text-foreground mt-1">
                  {item.value}
                </div>
                <div className="text-[11px] text-muted-foreground mt-0.5">
                  {item.hint}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 lg:px-8 pb-10 space-y-6 min-h-0">
          {viewMode === "api" ? renderApiView() : renderAdvancedView()}
        </div>
      </div>
    </div>
  );
}
