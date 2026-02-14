import packageInfo from "../../../../package.json";

// Official Links - 官方链接配置
export const APP_CONFIG = {
  // Application Info
  name: "Murasaki Translator",
  version: packageInfo.version,

  // Official Links
  officialRepo: "https://github.com/soundstarrain/Murasaki-Translator",
  projectRepo: "https://github.com/soundstarrain/Murasaki-project",
  feedbackEmail: "slimier.galls_9v@icloud.com",

  // Model Download Links - 模型下载地址
  modelDownload: {
    huggingfaceOrg: "Murasaki-Project", // Organization name for auto-discovery
    huggingface: "https://huggingface.co/Murasaki-Project", // Organization homepage
  },

  // Documentation
  docsUrl: "https://github.com/soundstarrain/Murasaki-Translator#readme",

  // Recommended Model
  recommendedModel: "Murasaki-8B-v0.2-Q4_K_M.gguf", // Updated to match actual model
} as const;

// Default Post-Processing Rules (matches RuleEditor post_novel preset)
// Used for system reset to ensure translation works immediately
export const DEFAULT_POST_RULES = [
  {
    id: "o1",
    type: "format",
    active: true,
    pattern: "ensure_double_newline",
    replacement: "",
    label: "强制双换行 (轻小说)",
  },
  {
    id: "o2",
    type: "format",
    active: true,
    pattern: "smart_quotes",
    replacement: "",
    label: "统一引号格式",
  },
] as const;
