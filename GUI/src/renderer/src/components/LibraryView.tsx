/**
 * LibraryView - 璁板繂搴?/ 闃熷垪绠＄悊涓績
 * 鎻愪緵: 闃熷垪绠＄悊銆佹嫋鏀惧鍏ャ€佸崟鏂囦欢鑷畾涔夐厤缃€佺洿鎺ヨ烦杞牎瀵? */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  FolderOpen,
  FileText,
  Trash2,
  GripVertical,
  AlignLeft,
  Plus,
  FolderPlus,
  X,
  ClipboardCheck,
  Cpu,
  MemoryStick,
  Settings,
  BookMarked,
  FolderOutput,
  Gauge,
  Zap,
  Scale,
  RotateCcw,
  Check,
  Sparkles,
  AlertTriangle,
  Info,
  Settings2,
  LayoutGrid,
  ArrowUp,
} from "lucide-react";
import { Button, Card, Switch, Tooltip as UITooltip } from "./ui/core";
import { FileIcon } from "./ui/FileIcon";
import { AlertModal } from "./ui/AlertModal";
import { useAlertModal } from "../hooks/useAlertModal";
import { Language } from "../lib/i18n";
import {
  QueueItem,
  FileConfig,
  generateId,
  getFileType,
} from "../types/common";

// ============ Types ============

interface LibraryViewProps {
  lang: Language;
  onNavigate?: (view: string) => void;
  onProofreadFile?: (cachePath: string) => void;
  isRunning?: boolean;
}

// ============ Constants ============

const LIBRARY_QUEUE_KEY = "library_queue";
const FILE_QUEUE_KEY = "file_queue";
const SUPPORTED_EXTENSIONS = [".txt", ".epub", ".srt", ".ass", ".ssa"];

// ============ Helpers ============

function getCachePath(filePath: string, outputDir?: string): string {
  // Fix: Handle both slash types correctly. lastIndexOf returns -1 if not found, checking both ensures we find the real separator.
  const lastSep = Math.max(
    filePath.lastIndexOf("\\"),
    filePath.lastIndexOf("/"),
  );
  const dir = outputDir
    ? outputDir
    : lastSep === -1
      ? "."
      : filePath.substring(0, lastSep);
  const baseName = filePath.substring(lastSep + 1).replace(/\.[^.]+$/, "");
  return `${dir}\\${baseName}_zh.cache.json`;
}

// ============ Texts ============

const texts = {
  zh: {
    title: "缈昏瘧闃熷垪",
    subtitle: "鎵归噺澶勭悊闃熷垪锛屼负姣忎釜鏂囦欢鎸囧畾鐙珛鍙傛暟",
    files: "涓枃浠?,
    dropHint: "鎷栨斁鏂囦欢鎴栨枃浠跺す鍒版澶勬坊鍔犲埌闃熷垪",
    dropTitle: "鎷栨斁鏂囦欢鍒拌繖閲?,
    emptyDragHint: "鎴栫偣鍑讳换鎰忓娴忚鏂囦欢",
    selectFiles: "閫夋嫨鏂囦欢",
    selectFolder: "閫夋嫨鏂囦欢澶?,
    scanSubdirs: "鎵弿瀛愮洰褰?,
    confirmClear: "纭畾瑕佹竻绌虹炕璇戦槦鍒楀悧锛?,
    supportedTypes: "鏀寔 .txt .epub .srt .ass",
    queueTitle: "缈昏瘧闃熷垪",
    emptyQueue: "闃熷垪涓虹┖",
    emptyHint: "鎷栨斁鏂囦欢鍒颁笂鏂瑰尯鍩燂紝鎴栫偣鍑绘寜閽€夋嫨",
    startAll: "寮€濮嬬炕璇?,
    clear: "娓呯┖鍏ㄩ儴",
    selected: "宸查€?,
    items: "椤?,
    remove: "绉婚櫎",
    selectAll: "鍏ㄩ€?,
    deselectAll: "鍙栨秷鍏ㄩ€?,
    default: "榛樿",
    proofread: "鏍″",
    config: "閰嶇疆",
    configTitle: "鏂囦欢缈昏瘧閰嶇疆",
    batchConfig: "鎵归噺閰嶇疆",
    configDesc: "瑕嗙洊鍏ㄥ眬璁剧疆锛屼负姝ゆ枃浠舵寚瀹氱嫭绔嬪弬鏁?,
    useGlobal: "浣跨敤鍏ㄥ眬榛樿閰嶇疆",
    useGlobalDesc: "鍙栨秷鍕鹃€変互鑷畾涔夋鏂囦欢鐨勭炕璇戝弬鏁?,
    moveToTop: "缃《",

    // Params
    model: "妯″瀷",
    glossary: "鏈琛?,
    outputDir: "杈撳嚭鐩綍",
    contextSize: "涓婁笅鏂囬暱搴?,
    temperature: "娓╁害",
    gpuLayers: "GPU灞傛暟",
    preset: "Prompt",
    concurrency: "骞跺彂鏁?,
    repPenaltyBase: "閲嶅鎯╃綒 (Base)",
    repPenaltyMax: "閲嶅鎯╃綒 (Max)",
    flashAttn: "Flash Attention",
    kvCacheType: "KV Cache 閲忓寲",
    alignmentMode: "杈呭姪瀵归綈",
    saveCot: "CoT 瀵煎嚭",

    save: "淇濆瓨閰嶇疆",
    cancel: "鍙栨秷",
    browse: "娴忚",
    reset: "閲嶇疆",
    notSet: "璺熼殢鍏ㄥ眬璁剧疆",
    currentGlobal: "褰撳墠鍏ㄥ眬",
    seed: "闅忔満绉嶅瓙 (Seed)",

    presetOptions: {
      novel: "杞诲皬璇存ā寮?(榛樿)",
      script: "鍓ф湰妯″紡",
      short: "鍗曞彞妯″紡",
    },
    kvOptions: {
      f16: "F16 (鎺ㄨ崘)",
      q8_0: "Q8_0 (鍧囪　)",
      q5_1: "Q5_1 (楂樻晥鍨?",
      q4_0: "Q4_0 (鐪佹樉瀛?",
    },
    help: {
      model:
        "浠呰鐩栨鏂囦欢浣跨敤鐨勬ā鍨嬨€傜暀绌哄垯璺熼殢鍏ㄥ眬妯″瀷閫夋嫨銆?,
      glossary:
        "鎸囧畾姝ゆ枃浠朵娇鐢ㄧ殑涓撳睘鏈琛ㄣ€傛湳璇〃甯姪妯″瀷鍑嗙‘缈昏瘧浜哄悕銆佸湴鍚嶅拰涓撴湁鍚嶈瘝銆?,
      outputDir: "璁剧疆缈昏瘧缁撴灉鐨勪繚瀛樼洰褰曘€傜暀绌哄垯涓庢簮鏂囦欢淇濆瓨鍦ㄥ悓涓€鐩綍銆?,
      contextSize:
        "妯″瀷涓€娆¤兘澶勭悊鐨勬枃鏈噺銆傛暟鍊艰秺楂樻樉瀛樺崰鐢ㄨ秺楂橈紝寤鸿 4096-8192銆?,
      concurrency: "骞惰缈昏瘧鐨勪换鍔℃暟銆傚鍔犲苟鍙戝彲鎻愬崌閫熷害锛屼絾鏄惧瓨鍗犵敤涔熶細澧炲姞銆?,
      temperature:
        "鎺у埗杈撳嚭闅忔満鎬с€傝緝浣庡€?(0.3-0.6) 鏇寸ǔ瀹氾紝杈冮珮鍊?(0.7-1.0) 鏇存湁鍒涙剰銆?,
      gpuLayers: "GPU 鍔犻€熷眰鏁般€?1 琛ㄧず鍏ㄩ儴鍔犺浇鍒版樉鍗★紝0 琛ㄧず浠?CPU銆?,
      repPenaltyBase: "閲嶅鎯╃綒鍒濆鍊笺€傜敤浜庢姂鍒舵ā鍨嬭緭鍑洪噸澶嶅唴瀹广€?,
      repPenaltyMax: "閲嶅鎯╃綒鏈€澶у€笺€傛娴嬪埌姝诲惊鐜椂鎯╃綒鍊间細閫掑鑷虫銆?,
      seed: "鍥哄畾闅忔満绉嶅瓙鍙娇杈撳嚭缁撴灉鍙鐜般€傜暀绌鸿〃绀洪殢鏈恒€?,
      preset: "杞诲皬璇存ā寮忛€傚悎缈昏瘧杞诲皬璇村拰杩炶疮鎬ч暱鏂囨湰锛涘墽鏈ā寮忛€傚悎 Galgame銆佸姩鐢诲瓧骞曘€佹极鐢伙紱鍗曞彞妯″紡閫傚悎瀵归綈瑕佹眰楂樼殑鐭彞锛屼絾鏁堢巼鍜屾晥鏋滀細涓嬮檷锛屼笉寤鸿浣跨敤",
    },
  },
  en: {
    title: "Workbench",
    subtitle:
      "Batch process queue, specify independent parameters for each file",

    seed: "Seed",
    currentGlobal: "Global",
    files: "files",
    dropHint: "Drop files or folders here to add to queue",
    dropTitle: "Drag & Drop Files Here",
    emptyDragHint: "Or click anywhere to browse",
    selectFiles: "Select Files",
    selectFolder: "Select Folder",
    scanSubdirs: "Scan Subdirs",
    confirmClear: "Are you sure you want to clear the translation queue?",
    supportedTypes: "Supports .txt .epub .srt .ass",
    queueTitle: "Translation Queue",
    emptyQueue: "Queue is empty",
    emptyHint: "Drop files above, or click buttons to select",
    startAll: "Start All",
    clear: "Clear",
    selected: "Selected",
    items: "items",
    remove: "Remove",
    selectAll: "Select All",
    deselectAll: "Deselect All",
    default: "Default",
    custom: "Custom",
    proofread: "Proofread",
    config: "Config",
    configTitle: "File Translation Config",
    batchConfig: "Batch Config",
    configDesc: "Override global settings with file-specific parameters",
    useGlobal: "Use Global Defaults",
    useGlobalDesc: "Uncheck to customize parameters for this file",
    moveToTop: "Top",

    model: "Model",
    glossary: "Glossary",
    outputDir: "Output Directory",
    contextSize: "Context Size",
    temperature: "Temperature",
    gpuLayers: "GPU Layers",
    preset: "Preset Mode",
    concurrency: "Concurrency",
    repPenaltyBase: "Rep. Penalty (Base)",
    repPenaltyMax: "Rep. Penalty (Max)",
    flashAttn: "Flash Attention",
    kvCacheType: "KV Cache Quant",
    alignmentMode: "Auxiliary Alignment",
    saveCot: "CoT Export",

    save: "Save Config",
    cancel: "Cancel",
    browse: "Browse",
    reset: "Reset",

    notSet: "Follow global setting",

    presetOptions: {
      novel: "Novel Mode (Default)",
      script: "Script Mode (Galgame)",
      short: "Short Mode",
    },
    kvOptions: {
      f16: "F16 (Recommended)",
      q8_0: "Q8_0 (Balanced)",
      q5_1: "Q5_1 (Efficient)",
      q4_0: "Q4_0 (Low VRAM)",
    },
    help: {
      model:
        "Override model for this file only. Leave unset to follow global model selection.",
      glossary:
        "Specify glossary for this file. Helps accurate translation of names and terms.",
      outputDir:
        "Set output directory. Leave empty to save alongside source file.",
      contextSize:
        "Text processing capacity. Higher values need more VRAM. Recommended: 4096-8192.",
      concurrency:
        "Parallel translation tasks. More concurrency = faster but more VRAM.",
      temperature:
        "Output randomness. Lower (0.3-0.6) = stable, higher (0.7-1.0) = creative.",
      gpuLayers: "GPU acceleration layers. -1 = all GPU, 0 = CPU only.",
      repPenaltyBase: "Initial repetition penalty. Suppresses repeated output.",
      repPenaltyMax: "Max repetition penalty for retry loops.",
      seed: "Fixed seed for reproducible output. Leave empty for random.",
      preset: "Novel mode for all novels and coherent long texts; Script mode for Galgame, anime subtitles, manga; Short mode for sentences requiring strict alignment, but efficiency and quality will decrease (not recommended)",
    },
  },
  jp: {
    title: "銉┿偆銉栥儵銉?,
    subtitle: "銈儱銉笺倰涓€鎷嚘鐞嗐仐銆併儠銈°偆銉仈銇ㄣ伀鍊嬪垾銇儜銉┿儭銉笺偪銈掓寚瀹?,

    seed: "銈枫兗銉?(Seed)",
    currentGlobal: "鐝惧湪銇偘銉兗銉愩儷鍊?,
    files: "銉曘偂銈ゃ儷",
    dropHint: "銉曘偂銈ゃ儷銇俱仧銇儠銈┿儷銉€銈掋儔銉儍銉椼仐銇﹁拷鍔?,
    dropTitle: "銉曘偂銈ゃ儷銈掋亾銇撱伀銉夈儹銉冦儣",
    emptyDragHint: "銇俱仧銇偗銉儍銈仐銇﹂伕鎶?,
    selectFiles: "銉曘偂銈ゃ儷閬告姙",
    selectFolder: "銉曘偐銉儉閬告姙",
    scanSubdirs: "銈点儢銉囥偅銉偗銉堛儶銈掋偣銈儯銉?,
    confirmClear: "缈昏ǔ銈儱銉笺倰绌恒伀銇椼仸銈傘倛銈嶃仐銇勩仹銇欍亱锛?,
    supportedTypes: ".txt .epub .srt .ass 銇蹇?,
    queueTitle: "缈昏ǔ銈儱銉?,
    emptyQueue: "銈儱銉笺亴绌恒仹銇?,
    emptyHint: "涓娿伀銉曘偂銈ゃ儷銈掋儔銉儍銉椼€併伨銇熴伅銉溿偪銉炽仹閬告姙",
    startAll: "缈昏ǔ闁嬪",
    clear: "銈儶銈?,
    selected: "閬告姙涓?,
    items: "浠?,
    remove: "鍓婇櫎",
    selectAll: "銇欍伖銇﹂伕鎶?,
    deselectAll: "閬告姙瑙ｉ櫎",
    default: "銉囥儠銈┿儷銉?,
    custom: "銈偣銈裤儬",
    proofread: "鏍℃",
    config: "瑷畾",
    configTitle: "銉曘偂銈ゃ儷缈昏ǔ瑷畾",
    batchConfig: "涓€鎷ō瀹?,
    configDesc: "銈般儹銉笺儛銉ō瀹氥倰涓婃浉銇嶃仐銇﹀€嬪垾銉戙儵銉°兗銈裤倰鎸囧畾",
    useGlobal: "銈般儹銉笺儛銉儑銉曘偐銉儓銈掍娇鐢?,
    useGlobalDesc: "銉併偋銉冦偗銈掑銇欍仺銇撱伄銉曘偂銈ゃ儷銇儜銉┿儭銉笺偪銈掋偒銈广偪銉炪偆銈?,
    moveToTop: "銉堛儍銉?,

    model: "銉儑銉?,
    glossary: "鐢ㄨ獮闆?,
    outputDir: "鍑哄姏銉囥偅銉偗銉堛儶",
    contextSize: "銈炽兂銉嗐偔銈广儓銈点偆銈?,
    temperature: "娓╁害",
    gpuLayers: "GPU銉偆銉ゃ兗",
    preset: "銉椼儶銈汇儍銉?,
    concurrency: "鍚屾檪瀹熻鏁?,
    repPenaltyBase: "绻般倞杩斻仐銉氥儕銉儐銈?(Base)",
    repPenaltyMax: "绻般倞杩斻仐銉氥儕銉儐銈?(Max)",
    flashAttn: "Flash Attention",
    kvCacheType: "KV Cache 閲忓瓙鍖?,
    alignmentMode: "瑁滃姪銈儵銈ゃ兂銉°兂銉?,
    saveCot: "CoT 銈ㄣ偗銈广儩銉笺儓",

    save: "瑷畾銈掍繚瀛?,
    cancel: "銈儯銉炽偦銉?,
    browse: "鍙傜収",
    reset: "銉偦銉冦儓",

    notSet: "銈般儹銉笺儛銉ō瀹氥伀寰撱亞",

    presetOptions: {
      novel: "灏忚銉兗銉?(銉囥儠銈┿儷銉?",
      script: "銈广偗銉儣銉堛儮銉笺儔 (銈儯銉偛銉?",
      short: "鐭枃銉兗銉?,
    },
    kvOptions: {
      f16: "F16 (鎺ㄥエ)",
      q8_0: "Q8_0 (銉愩儵銉炽偣)",
      q5_1: "Q5_1 (鍔圭巼鐨?",
      q4_0: "Q4_0 (浣嶸RAM)",
    },
    help: {
      model:
        "銇撱伄銉曘偂銈ゃ儷銇犮亼銉儑銉倰涓婃浉銇嶃仐銇俱仚銆傛湭瑷畾銇倝銈般儹銉笺儛銉儮銉囥儷銈掍娇鐢ㄣ仐銇俱仚銆?,
      glossary:
        "銇撱伄銉曘偂銈ゃ儷灏傜敤銇敤瑾為泦銈掓寚瀹氥€傚悕鍓嶃仾銇┿伄姝ｇ⒑銇炕瑷炽伀褰圭珛銇°伨銇欍€?,
      outputDir: "鍑哄姏銉囥偅銉偗銉堛儶銈掕ō瀹氥€傜┖銇牬鍚堛伅銈姐兗銈广仺鍚屻仒鍫存墍銇繚瀛樸€?,
      contextSize:
        "銉嗐偔銈广儓鍑︾悊瀹归噺銆傚ぇ銇嶃亜鍊ゃ伅銈堛倞澶氥亸銇甐RAM銈掍娇鐢ㄣ€傛帹濂? 4096-8192銆?,
      concurrency: "涓﹀垪銈裤偣銈暟銆傚銈勩仚銇ㄩ€熴亸銇倠銇孷RAM浣跨敤閲忋倐澧楀姞銆?,
      temperature:
        "鍑哄姏銇儵銉炽儉銉犳€с€備綆銇?(0.3-0.6) = 瀹夊畾銆侀珮銇?(0.7-1.0) = 鍓甸€犵殑銆?,
      gpuLayers: "GPU鍔犻€熴儸銈ゃ儰銉笺€?1 = 鍏℅PU銆? = CPU銇伩銆?,
      repPenaltyBase: "绻般倞杩斻仐銉氥儕銉儐銈ｃ伄鍒濇湡鍊ゃ€傞噸瑜囧嚭鍔涖倰鎶戝埗銆?,
      repPenaltyMax: "銉儓銉┿偆銉兗銉椼伄鏈€澶с儦銉娿儷銉嗐偅鍊ゃ€?,
      seed: "鍐嶇従鍙兘銇嚭鍔涖伄銇熴倎銇浐瀹氥偡銉笺儔銆傜┖銇牬鍚堛伅銉┿兂銉€銉犮€?,
      preset: "灏忚銉兗銉夈伅鍏ㄣ仸銇皬瑾仺闀锋枃鍚戙亼銆併偣銈儶銉椼儓銉兗銉夈伅銈儯銉偛銉笺兓銈儖銉″瓧骞曘兓婕敾鍚戙亼銆佺煭鏂囥儮銉笺儔銇偄銉┿偆銉°兂銉堥噸瑕栥伄鐭枃鍚戙亼銇с仚銇屽姽鐜囥仺鍝佽唱銇屼綆涓嬨仚銈嬨仧銈侀潪鎺ㄥエ",
    },
  },
};

// ============ FileConfigModal ============

interface FileConfigModalProps {
  item: QueueItem;
  lang: Language;
  onSave: (config: FileConfig) => void;
  onClose: () => void;
}

export function FileConfigModal({
  item,
  lang,
  onSave,
  onClose,
}: FileConfigModalProps) {
  const t = texts[lang];
  const [config, setConfig] = useState<FileConfig>({ ...item.config });
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    const loadModels = async () => {
      try {
        const models = await window.api?.getModels();
        if (alive && Array.isArray(models)) {
          setAvailableModels(models);
        }
      } catch (error) {
        console.error("[FileConfigModal] Failed to load models:", error);
      }
    };
    loadModels();
    return () => {
      alive = false;
    };
  }, []);

  // Get global defaults for display
  const globalModel = localStorage.getItem("config_model") || "";
  const formatModelName = (path: string) =>
    (path.split(/[/\\]/).pop() || path).replace(/\.gguf$/i, "");
  const globalModelDisplay = globalModel
    ? formatModelName(globalModel)
    : lang === "zh"
      ? "鏈缃?
      : "Not set";
  const globalGlossary = localStorage.getItem("config_glossary_path") || "";
  const globalCtx = localStorage.getItem("config_ctx") || "4096";
  const globalConcurrency = localStorage.getItem("config_concurrency") || "1";
  const globalTemp = localStorage.getItem("config_temperature") || "0.7";
  const globalGpu = localStorage.getItem("config_gpu") || "-1";
  const globalPreset = localStorage.getItem("config_preset") || "novel";
  const globalRepBase =
    localStorage.getItem("config_rep_penalty_base") || "1.0";
  const globalRepMax = localStorage.getItem("config_rep_penalty_max") || "1.5";
  const globalFlashAttn = localStorage.getItem("config_flash_attn") !== "false";
  const globalKvCache = localStorage.getItem("config_kv_cache_type") || "f16";
  const globalSeed = localStorage.getItem("config_seed") || "";
  const globalAlignmentMode =
    localStorage.getItem("config_alignment_mode") === "true";
  const globalSaveCot = localStorage.getItem("config_save_cot") === "true";

  const handleSelectGlossary = async () => {
    if (config.useGlobalDefaults) return;
    const result = await window.api?.selectFile({
      title: t.glossary,
      filters: [{ name: "Glossary Files", extensions: ["json", "txt"] }],
    });
    if (result) {
      setConfig((prev) => ({ ...prev, glossaryPath: result }));
    }
  };

  const handleSelectOutputDir = async () => {
    if (config.useGlobalDefaults) return;
    const result = await window.api?.selectFolder();
    if (result) {
      setConfig((prev) => ({ ...prev, outputDir: result }));
    }
  };

  const handleReset = () => {
    setConfig({ useGlobalDefaults: true });
  };

  // Helper for Inputs
  const InputRow = ({
    icon: Icon,
    label,
    value,
    onChange,
    placeholder,
    onBrowse,
    type = "text",
    min,
    max,
    step,
    globalValue,
    helpText,
    className = "",
  }: {
    icon: React.ElementType;
    label: string;
    value: string | number | undefined;
    onChange: (val: string) => void;
    placeholder?: string;
    onBrowse?: () => void;
    type?: "text" | "number";
    min?: number;
    max?: number;
    step?: number;
    globalValue?: string;
    helpText?: string;
    className?: string;
  }) => {
    // Display logic for empty global values
    const displayGlobalValue =
      globalValue === "" || globalValue === undefined
        ? lang === "zh"
          ? "鏈缃?
          : "Not set"
        : globalValue.length > 20
          ? "..." + globalValue.slice(-20)
          : globalValue;

    return (
      <div className={`space-y-1.5 ${className}`}>
        <div className="flex items-center justify-between">
          <label
            className={`text-xs font-medium flex items-center gap-1.5 truncate ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
          >
            <Icon className="w-3.5 h-3.5 shrink-0 opacity-70" />
            {label}
            {helpText && (
              <UITooltip content={helpText}>
                <Info className="w-3 h-3 text-muted-foreground/50 hover:text-primary cursor-help" />
              </UITooltip>
            )}
          </label>
          {/* Always show Global Value at the top right for reference */}
          <span className="text-[10px] text-muted-foreground/50 shrink-0 ml-2 tabular-nums">
            {t.currentGlobal}: {displayGlobalValue}
          </span>
        </div>
        <div className="flex gap-2">
          <input
            type={type}
            value={config.useGlobalDefaults ? "" : (value ?? "")}
            onChange={(e) => onChange(e.target.value)}
            placeholder={
              config.useGlobalDefaults
                ? globalValue ||
                placeholder ||
                (lang === "zh" ? "鏈缃? : "Not set")
                : placeholder || t.notSet
            }
            disabled={config.useGlobalDefaults}
            min={min}
            max={max}
            step={step}
            className={`
                            flex-1 h-8 px-2.5 text-sm rounded-md border transition-all outline-none
                            ${config.useGlobalDefaults
                ? "bg-secondary/30 border-transparent text-muted-foreground/50 cursor-not-allowed placeholder:text-muted-foreground/40"
                : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
              }
                        `}
          />
          {onBrowse && (
            <Button
              variant="outline"
              size="sm"
              onClick={onBrowse}
              disabled={config.useGlobalDefaults}
              className={`shrink-0 h-8 px-2.5 ${config.useGlobalDefaults ? "opacity-50" : ""}`}
            >
              <FolderOpen className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-[600px] max-h-[90vh] overflow-hidden animate-in fade-in zoom-in-95 duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Optimized Layout */}
        <div className="px-5 py-4 border-b border-border bg-gradient-to-r from-purple-500/5 to-transparent shrink-0">
          <div className="flex items-center gap-4">
            {/* Left: Icon and Title */}
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="font-semibold text-foreground">
                  {t.configTitle}
                </h3>
                <p
                  className="text-xs text-muted-foreground truncate max-w-[280px]"
                  title={item.path}
                >
                  {item.fileName}
                </p>
              </div>
            </div>

            {/* Right: Toggle and Close */}
            <div className="flex items-center gap-3 shrink-0">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span
                  className={`text-xs font-medium ${config.useGlobalDefaults ? "text-primary" : "text-muted-foreground"}`}
                >
                  {t.useGlobal}
                </span>
                <Switch
                  checked={config.useGlobalDefaults}
                  onCheckedChange={(c) =>
                    setConfig((prev) => ({ ...prev, useGlobalDefaults: c }))
                  }
                />
              </label>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Content - Always Visible */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Warning Banner */}
          {!config.useGlobalDefaults && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                {lang === "zh"
                  ? "淇敼鍓嶈纭繚鎮ㄤ簡瑙ｆ鍦ㄤ慨鏀圭殑鍐呭锛岄敊璇殑閰嶇疆鍙兘瀵艰嚧缈昏瘧杩囩▼寮傚父鎴栫粨鏋滆川閲忎笅闄嶃€?
                  : "Please ensure you understand what you are modifying. Incorrect settings may cause translation errors or quality degradation."}
              </p>
            </div>
          )}

          {/* 1. Prompt Preset Section - 鏈€閲嶈锛屾斁绗竴 */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
              >
                <Cpu className="w-3.5 h-3.5 shrink-0 opacity-70" />
                {t.model}
                <UITooltip
                  content={
                    t.help.model
                  }
                >
                  <Info className="w-3 h-3 text-muted-foreground/50 hover:text-primary cursor-help" />
                </UITooltip>
              </label>
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                {t.currentGlobal}: {globalModelDisplay}
              </span>
            </div>
            <select
              value={
                !config.useGlobalDefaults && config.model ? config.model : ""
              }
              disabled={config.useGlobalDefaults}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  model: e.target.value || undefined,
                }))
              }
              className={`
                w-full h-8 px-2.5 text-sm rounded-md border transition-all outline-none
                ${config.useGlobalDefaults
                  ? "bg-secondary/30 border-transparent text-muted-foreground/50 cursor-not-allowed"
                  : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                }
              `}
            >
              <option
                value=""
                disabled={!config.useGlobalDefaults && !config.model}
              >
                {config.useGlobalDefaults ? globalModelDisplay : t.notSet}
              </option>
              {availableModels.map((path) => (
                <option key={path} value={path}>
                  {formatModelName(path)}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
              >
                <Settings className="w-3.5 h-3.5 shrink-0 opacity-70" />
                {t.preset}
                <UITooltip content={t.help?.preset || "閫夋嫨缈昏瘧妯″紡锛氳交灏忚閫傚悎闀挎枃鏈紝鍓ф湰閫傚悎瀵硅瘽锛屽崟鍙ラ€傚悎闆舵暎鍐呭"}>
                  <Info className="w-3 h-3 text-muted-foreground/50 hover:text-primary cursor-help" />
                </UITooltip>
              </label>
              <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                {t.currentGlobal}: {globalPreset}
              </span>
            </div>
            <select
              value={
                !config.useGlobalDefaults && config.preset
                  ? config.preset
                  : ""
              }
              disabled={config.useGlobalDefaults}
              onChange={(e) =>
                setConfig((prev) => ({
                  ...prev,
                  preset: e.target.value || undefined,
                }))
              }
              className={`
                w-full h-8 px-2.5 text-sm rounded-md border transition-all outline-none
                ${config.useGlobalDefaults
                  ? "bg-secondary/30 border-transparent text-muted-foreground/50 cursor-not-allowed"
                  : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                }
              `}
            >
              <option
                value=""
                disabled={!config.useGlobalDefaults && !config.preset}
              >
                {config.useGlobalDefaults ? globalPreset : t.notSet}
              </option>
              <option value="novel">{t.presetOptions.novel}</option>
              <option value="script">{t.presetOptions.script}</option>
              <option value="short">{t.presetOptions.short}</option>
            </select>
            {/* 鐭彞妯″紡璀﹀憡 */}
            {!config.useGlobalDefaults && config.preset === "short" && (
              <div className="flex items-start gap-1.5 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-amber-600 dark:text-amber-400 leading-relaxed">
                  {lang === "zh"
                    ? "鐭彞妯″紡浼氬鑷寸炕璇戞晥鐜囧拰璐ㄩ噺涓嬮檷锛屽缓璁娇鐢ㄨ交灏忚鎴栧墽鏈ā寮忋€?
                    : "Short mode is only for isolated sentences. Use Novel or Script mode for documents."}
                </p>
              </div>
            )}
          </div>

          {/* 2. Paths Section - 鏈琛ㄥ拰杈撳嚭鐩綍 */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Paths & Directories
            </h4>
            <div className="grid grid-cols-1 gap-4">
              <InputRow
                icon={BookMarked}
                label={t.glossary}
                value={config.glossaryPath}
                onChange={(val) =>
                  setConfig((prev) => ({ ...prev, glossaryPath: val }))
                }
                onBrowse={handleSelectGlossary}
                globalValue={globalGlossary.split(/[/\\]/).pop()}
                helpText={t.help?.glossary}
              />
              <InputRow
                icon={FolderOutput}
                label={t.outputDir}
                value={config.outputDir}
                onChange={(val) =>
                  setConfig((prev) => ({ ...prev, outputDir: val }))
                }
                onBrowse={handleSelectOutputDir}
                helpText={t.help?.outputDir}
              />
            </div>
          </div>


          {/* Core Params Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Core Parameters
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <InputRow
                icon={Gauge}
                label={t.contextSize}
                value={config.contextSize}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    contextSize: parseInt(val) || undefined,
                  }))
                }
                type="number"
                step={1024}
                globalValue={globalCtx}
                helpText={t.help?.contextSize}
              />
              <InputRow
                icon={LayoutGrid}
                label={t.concurrency}
                value={config.concurrency}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    concurrency: parseInt(val) || undefined,
                  }))
                }
                type="number"
                min={1}
                max={8}
                globalValue={globalConcurrency}
                helpText={t.help?.concurrency}
              />
              <InputRow
                icon={Zap}
                label={t.temperature}
                value={config.temperature}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    temperature: parseFloat(val) || undefined,
                  }))
                }
                type="number"
                step={0.1}
                min={0}
                max={2}
                globalValue={globalTemp}
                helpText={t.help?.temperature}
              />
              <InputRow
                icon={Cpu}
                label={t.gpuLayers}
                value={config.gpuLayers}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    gpuLayers: val === "" ? -1 : parseInt(val) || -1,
                  }))
                }
                type="number"
                globalValue={globalGpu}
                helpText={t.help?.gpuLayers}
              />
            </div>
          </div>

          <div className="h-px bg-border/50" />

          {/* Advanced Params Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Advanced Engine Tuning
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <InputRow
                icon={Scale}
                label={t.repPenaltyBase}
                value={config.repPenaltyBase}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    repPenaltyBase: parseFloat(val) || undefined,
                  }))
                }
                type="number"
                step={0.01}
                globalValue={globalRepBase}
                helpText={t.help?.repPenaltyBase}
              />
              <InputRow
                icon={Scale}
                label={t.repPenaltyMax}
                value={config.repPenaltyMax}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    repPenaltyMax: parseFloat(val) || undefined,
                  }))
                }
                type="number"
                step={0.01}
                globalValue={globalRepMax}
                helpText={t.help?.repPenaltyMax}
              />

              {/* KV Cache */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    className={`text-xs font-medium flex items-center gap-1.5 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    <MemoryStick className="w-3.5 h-3.5 shrink-0 opacity-70" />
                    {t.kvCacheType}
                  </label>
                  <span className="text-[10px] text-muted-foreground/50 tabular-nums">
                    {t.currentGlobal}: {globalKvCache}
                  </span>
                </div>
                <select
                  value={
                    !config.useGlobalDefaults && config.kvCacheType
                      ? config.kvCacheType
                      : ""
                  }
                  disabled={config.useGlobalDefaults}
                  onChange={(e) =>
                    setConfig((prev) => ({
                      ...prev,
                      kvCacheType: e.target.value || undefined,
                    }))
                  }
                  className={`
                                        w-full h-8 px-2.5 text-sm rounded-md border transition-all outline-none
                                        ${config.useGlobalDefaults
                      ? "bg-secondary/30 border-transparent text-muted-foreground/50 cursor-not-allowed"
                      : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                    }
                                    `}
                >
                  <option
                    value=""
                    disabled={!config.useGlobalDefaults && !config.kvCacheType}
                  >
                    {config.useGlobalDefaults ? globalKvCache : t.notSet}
                  </option>
                  <option value="f16">{t.kvOptions.f16}</option>
                  <option value="q8_0">{t.kvOptions.q8_0}</option>
                  <option value="q5_1">{t.kvOptions.q5_1}</option>
                  <option value="q4_0">{t.kvOptions.q4_0}</option>
                </select>
              </div>

              {/* Seed Input */}
              <InputRow
                icon={Sparkles}
                label={t.seed}
                value={config.seed}
                onChange={(val) =>
                  setConfig((prev) => ({
                    ...prev,
                    seed: val ? parseInt(val) : undefined,
                  }))
                }
                type="number"
                placeholder={
                  config.useGlobalDefaults ? globalSeed || "Random" : "Random"
                }
                globalValue={globalSeed}
                helpText={t.help?.seed}
              />
            </div>
          </div>

          <div className="h-px bg-border/50" />

          {/* Features Section */}
          <div className="space-y-4">
            <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Feature Toggles
            </h4>
            <div className="grid grid-cols-2 gap-4">
              <div
                className={`
                                flex items-center justify-between p-3 rounded-lg border transition-colors
                                ${config.useGlobalDefaults ? "bg-secondary/20 border-transparent opacity-60" : "bg-background/30 border-border"}
                            `}
              >
                <div className="flex items-center gap-2">
                  <AlignLeft
                    className={`w-4 h-4 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-indigo-500"}`}
                  />
                  <span
                    className={`text-sm font-medium ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {t.alignmentMode}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground">
                    {t.currentGlobal}: {globalAlignmentMode ? "On" : "Off"}
                  </span>
                  <Switch
                    checked={
                      config.useGlobalDefaults
                        ? globalAlignmentMode
                        : (config.alignmentMode ?? globalAlignmentMode)
                    }
                    disabled={config.useGlobalDefaults}
                    onCheckedChange={(c) =>
                      setConfig((prev) => ({ ...prev, alignmentMode: c }))
                    }
                    className="scale-75"
                  />
                </div>
              </div>

              <div
                className={`
                                flex items-center justify-between p-3 rounded-lg border transition-colors
                                ${config.useGlobalDefaults ? "bg-secondary/20 border-transparent opacity-60" : "bg-background/30 border-border"}
                            `}
              >
                <div className="flex items-center gap-2">
                  <FileText
                    className={`w-4 h-4 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-amber-500"}`}
                  />
                  <span
                    className={`text-sm font-medium ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                  >
                    {t.saveCot}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] text-muted-foreground">
                    {t.currentGlobal}: {globalSaveCot ? "On" : "Off"}
                  </span>
                  <Switch
                    checked={
                      config.useGlobalDefaults
                        ? globalSaveCot
                        : (config.saveCot ?? false)
                    }
                    disabled={config.useGlobalDefaults}
                    onCheckedChange={(c) =>
                      setConfig((prev) => ({ ...prev, saveCot: c }))
                    }
                    className="scale-75"
                  />
                </div>
              </div>
            </div>

            {/* Flash Attention (Full Width or Grid) */}
            <div
              className={`
                            flex items-center justify-between p-3 rounded-lg border transition-colors
                            ${config.useGlobalDefaults
                  ? "bg-secondary/20 border-transparent opacity-60"
                  : "bg-background/30 border-border"
                }
                        `}
            >
              <div className="flex items-center gap-2">
                <Zap
                  className={`w-4 h-4 ${config.useGlobalDefaults ? "text-muted-foreground" : "text-amber-500"}`}
                />
                <span
                  className={`text-sm font-medium ${config.useGlobalDefaults ? "text-muted-foreground" : "text-foreground"}`}
                >
                  {t.flashAttn}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground">
                  {t.currentGlobal}: {globalFlashAttn ? "On" : "Off"}
                </span>
                <select
                  className={`
                                        h-8 text-sm rounded-md border outline-none
                                        ${config.useGlobalDefaults
                      ? "bg-transparent border-transparent text-muted-foreground cursor-not-allowed"
                      : "bg-background/50 border-border focus:ring-2 focus:ring-primary/20"
                    }
                                    `}
                  value={
                    config.useGlobalDefaults
                      ? globalFlashAttn
                        ? "true"
                        : "false"
                      : config.flashAttn === undefined
                        ? "default"
                        : config.flashAttn
                          ? "true"
                          : "false"
                  }
                  disabled={config.useGlobalDefaults}
                  onChange={(e) => {
                    const val = e.target.value;
                    setConfig((prev) => ({
                      ...prev,
                      flashAttn: val === "default" ? undefined : val === "true",
                    }));
                  }}
                >
                  <option value="default" disabled>
                    {t.notSet}
                  </option>
                  <option value="true">On</option>
                  <option value="false">Off</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between bg-secondary/10 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="text-muted-foreground hover:text-foreground"
          >
            <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
            {t.reset}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t.cancel}
            </Button>
            <Button variant="default" size="sm" onClick={() => onSave(config)}>
              <Check className="w-3.5 h-3.5 mr-1.5" />
              {t.save}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ============ Main Component ============
// (Keeping existing LibraryView but need to re-export it to render)
// Just copy the whole Main Component again to ensure consistency and imports match

export function LibraryView({
  lang,
  onNavigate,
  onProofreadFile,
  isRunning = false,
}: LibraryViewProps) {
  const t = texts[lang];
  const { alertProps, showConfirm } = useAlertModal();
  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>(() => {
    try {
      const saved = localStorage.getItem(LIBRARY_QUEUE_KEY);
      if (saved) return JSON.parse(saved);
    } catch (e) {
      console.error("[LibraryView] Load failed:", e);
    }

    // Migrate from legacy
    try {
      const legacy = localStorage.getItem(FILE_QUEUE_KEY);
      if (legacy) {
        const paths = JSON.parse(legacy) as string[];
        return paths.map((path) => ({
          id: generateId(),
          path,
          fileName: path.split(/[/\\]/).pop() || path,
          fileType: getFileType(path),
          addedAt: new Date().toISOString(),
          config: { useGlobalDefaults: true },
          status: "pending" as const,
        }));
      }
    } catch (e) {
      console.error("[LibraryView] Migration failed:", e);
    }

    return [];
  });

  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [configItem, setConfigItem] = useState<QueueItem | null>(null);
  const [scanSubdirs, setScanSubdirs] = useState(() => {
    const saved = localStorage.getItem("murasaki_scan_subdirs");
    return saved === "true";
  }); // Toggle for recursive scan
  const [isReordering, setIsReordering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(LIBRARY_QUEUE_KEY, JSON.stringify(queue));
      localStorage.setItem(
        FILE_QUEUE_KEY,
        JSON.stringify(queue.map((q) => q.path)),
      );
    } catch (e) {
      console.error("[LibraryView] Save failed:", e);
    }
  }, [queue]);

  // Add files
  const addFiles = useCallback(
    (paths: string[]) => {
      const existingPaths = new Set(queue.map((q) => q.path));
      const newItems: QueueItem[] = [];

      for (const path of paths) {
        const ext = "." + path.split(".").pop()?.toLowerCase();
        if (!SUPPORTED_EXTENSIONS.includes(ext)) continue;
        if (existingPaths.has(path)) continue;

        existingPaths.add(path);
        newItems.push({
          id: generateId(),
          path,
          fileName: path.split(/[/\\]/).pop() || path,
          fileType: getFileType(path),
          addedAt: new Date().toISOString(),
          config: { useGlobalDefaults: true },
          status: "pending",
        });
      }

      if (newItems.length > 0) setQueue((prev) => [...prev, ...newItems]);
    },
    [queue],
  );

  const handleAddFiles = async () => {
    if (isRunning) return;
    const files = await window.api?.selectFiles();
    if (files?.length) addFiles(files);
  };

  const handleAddFolder = async () => {
    if (isRunning) return;
    // Since window.api.selectFolderFiles assumes shallow or specific backend logic which we can't easily change from here without changing select-folder-files channel
    // Let's use selectDirectory to get path and then scanDirectory
    const path = await window.api?.selectFolder();
    if (path) {
      const files = await window.api?.scanDirectory(path, scanSubdirs);
      if (files && files.length > 0) {
        addFiles(files);
      }
    }
  };

  // Drag handlers
  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (isRunning) return;

      // Only show overlay if dragging Files (not internal reorder)
      if (e.dataTransfer.types.includes("Files") && !isReordering) {
        setIsDragOver(true);
      }
    },
    [isReordering, isRunning],
  );

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (isRunning) {
        setIsDragOver(false);
        return;
      }

      setIsDragOver(false);

      const items = Array.from(e.dataTransfer.items);
      const paths: string[] = [];

      for (const item of items) {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file && (file as any).path) {
            paths.push((file as any).path);
          }
        }
      }

      if (paths.length > 0) {
        const finalPaths: string[] = [];
        // Scan for folders using backend API to support recursion/filtering
        for (const p of paths) {
          try {
            const expanded = await window.api?.scanDirectory(p, scanSubdirs);
            if (expanded && expanded.length > 0) {
              finalPaths.push(...expanded);
            }
          } catch (e) {
            console.error("Scan failed for", p, e);
          }
        }
        if (finalPaths.length > 0) addFiles(finalPaths);
      }
    },
    [addFiles, scanSubdirs],
  );

  // Queue operations
  const handleRemove = useCallback(
    (id: string) => {
      if (isRunning) return;
      const item = queue.find((q) => q.id === id);
      if (!item) return;

      if (item.status === "completed") {
        setQueue((prev) => prev.filter((q) => q.id !== id));
        setSelectedItems((prev) => {
          const n = new Set(prev);
          n.delete(id);
          return n;
        });
        return;
      }

      showConfirm({
        title: lang === "zh" ? "纭绉婚櫎" : "Confirm Remove",
        description:
          lang === "zh"
            ? "纭畾瑕佷粠闃熷垪涓Щ闄ゆ鏂囦欢鍚楋紵"
            : "Are you sure you want to remove this file from the queue?",
        variant: "destructive",
        onConfirm: () => {
          setQueue((prev) => prev.filter((q) => q.id !== id));
          setSelectedItems((prev) => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        },
      });
    },
    [lang, showConfirm, isRunning, queue],
  );

  const handleClearCompleted = useCallback(() => {
    if (isRunning) return;
    const completedCount = queue.filter((q) => q.status === "completed").length;
    if (completedCount === 0) return;

    setQueue((prev) => prev.filter((q) => q.status !== "completed"));

    // Sync selection
    setSelectedItems((prev) => {
      const next = new Set<string>();
      // Need to know which IDs are NOT completed.
      // Better to just filter based on new queue, but we don't have new queue here easily in callback without recalc.
      // Queue is in dep array, so we can use it.
      queue.forEach((q) => {
        if (q.status !== "completed" && prev.has(q.id)) next.add(q.id);
      });
      return next;
    });

    window.api?.showNotification(
      "Murasaki Translator",
      lang === "zh"
        ? `宸叉竻鐞?${completedCount} 涓凡瀹屾垚浠诲姟`
        : `Cleared ${completedCount} completed tasks`,
    );
  }, [queue, isRunning, lang]);

  const handleRemoveSelected = useCallback(() => {
    if (isRunning) return;
    if (selectedItems.size === 0) return;
    showConfirm({
      title: lang === "zh" ? "纭绉婚櫎宸查€? : "Confirm Remove Selected",
      description:
        lang === "zh"
          ? `纭畾瑕佺Щ闄ら€変腑鐨?${selectedItems.size} 涓枃浠跺悧锛焋
          : `Are you sure you want to remove the ${selectedItems.size} selected files?`,
      variant: "destructive",
      onConfirm: () => {
        setQueue((prev) => prev.filter((q) => !selectedItems.has(q.id)));
        setSelectedItems(new Set());
      },
    });
  }, [selectedItems, lang, showConfirm, isRunning]);

  const handleMoveToTop = useCallback(
    (id: string) => {
      if (isRunning) return;
      setQueue((prev) => {
        const index = prev.findIndex((q) => q.id === id);
        if (index <= 0) return prev;
        const newQueue = [...prev];
        const [item] = newQueue.splice(index, 1);
        return [item, ...newQueue];
      });
    },
    [isRunning],
  );

  const handleClear = useCallback(() => {
    if (isRunning) return;
    showConfirm({
      title: t.clear,
      description: (t as any).confirmClear || "Confirm Clear Queue?",
      variant: "destructive",
      onConfirm: () => {
        setQueue([]);
        setSelectedItems(new Set());
      },
    });
  }, [t, showConfirm]);

  useEffect(() => {
    localStorage.setItem("murasaki_scan_subdirs", scanSubdirs.toString());
  }, [scanSubdirs]);

  const toggleSelection = useCallback((id: string) => {
    setSelectedItems((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    if (selectedItems.size === queue.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(queue.map((q) => q.id)));
  }, [queue, selectedItems]);

  const handleInvertSelection = useCallback(() => {
    setSelectedItems((prev) => {
      const next = new Set<string>();
      queue.forEach((item) => {
        if (!prev.has(item.id)) next.add(item.id);
      });
      return next;
    });
  }, [queue]);

  // Drag reorder
  const handleDragStart = useCallback(
    (e: React.DragEvent, index: number) => {
      if (isRunning) {
        e.preventDefault();
        return;
      }
      setIsReordering(true);
      e.dataTransfer.setData("text/plain", index.toString());
      e.dataTransfer.effectAllowed = "move";
      // Create a custom drag image or hide it if needed, but default is usually fine
    },
    [isRunning],
  );

  const handleDragEnd = useCallback(() => {
    setIsReordering(false);
    setIsDragOver(false);
  }, []);

  const handleReorderDrop = useCallback(
    (e: React.DragEvent, targetIndex: number) => {
      e.preventDefault();
      const sourceIndexStr = e.dataTransfer.getData("text/plain");
      if (!sourceIndexStr) return;

      const sourceIndex = parseInt(sourceIndexStr);
      if (isNaN(sourceIndex) || sourceIndex === targetIndex) return;

      setQueue((prev) => {
        const newQueue = [...prev];
        const [removed] = newQueue.splice(sourceIndex, 1);
        newQueue.splice(targetIndex, 0, removed);
        return newQueue;
      });
    },
    [],
  );

  // Config save
  const handleSaveConfig = useCallback((itemId: string, config: FileConfig) => {
    setQueue((prev) =>
      prev.map((q) => (q.id === itemId ? { ...q, config } : q)),
    );
    setConfigItem(null);
  }, []);

  const handleOpenBatchConfig = useCallback(() => {
    if (selectedItems.size === 0) return;

    // Use the first selected item's config as base or global defaults
    const firstId = Array.from(selectedItems)[0];
    const baseItem = queue.find((q) => q.id === firstId);
    if (!baseItem) return;

    // Open config modal with a virtual item representing the batch
    setConfigItem({
      ...baseItem,
      id: "batch", // Special ID to indicate batch mode
      fileName:
        lang === "zh"
          ? `鎵归噺閰嶇疆 (${selectedItems.size} 涓枃浠?`
          : `Batch Config (${selectedItems.size} files)`,
    });
  }, [selectedItems, queue, lang]);

  const handleBatchSave = useCallback(
    (config: FileConfig) => {
      setQueue((prev) =>
        prev.map((q) => (selectedItems.has(q.id) ? { ...q, config } : q)),
      );
      setConfigItem(null);
    },
    [selectedItems],
  );

  // Navigation
  // Navigation
  // Navigation
  // Navigation
  const handleProofread = useCallback(
    (item: QueueItem) => {
      let targetPath = "";

      // Strategy 1: Look up in Translation History (Source of Truth)
      try {
        const historyStr = localStorage.getItem("translation_history");
        if (historyStr) {
          const history = JSON.parse(historyStr);
          // Normalize item path for comparison
          const normItemPath = item.path.toLowerCase().replace(/[/\\]/g, "\\");

          // Find most recent matching record
          const match = history.find((h: any) => {
            const hPath = (h.filePath || h.inputPath || "")
              .toLowerCase()
              .replace(/[/\\]/g, "\\");
            return hPath === normItemPath;
          });

          if (match) {
            // Logic copied from ProofreadView: history record -> cache path
            if (match.cachePath) targetPath = match.cachePath;
            else if (match.outputPath)
              targetPath = match.outputPath + ".cache.json";
            else targetPath = match.filePath + ".cache.json";
          }
        }
      } catch (e) {
        console.error("History lookup failed", e);
      }

      // Strategy 2: Default Guess (Fallback if not in history)
      if (!targetPath) {
        let outputDir = item.config?.outputDir;
        if (!outputDir && item.config?.useGlobalDefaults) {
          outputDir = localStorage.getItem("config_output_dir") || undefined;
        }
        targetPath = getCachePath(item.path, outputDir);
      }

      console.log("[Proofread] Resolved target:", targetPath);

      // Direct navigation
      if (onProofreadFile) onProofreadFile(targetPath);
      else {
        localStorage.setItem("proofread_target_file", targetPath);
        onNavigate?.("proofread");
      }
    },
    [onNavigate, onProofreadFile],
  );

  return (
    <div
      ref={containerRef}
      className="flex-1 h-screen flex flex-col bg-background overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Header */}
      <div className="px-8 py-6 border-b border-border/40 bg-background/50 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground tracking-tight">
              {t.title}
            </h1>
            {queue.length > 0 && (
              <span className="text-sm font-normal text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                {queue.length}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Global Drop Overlay - Only show when dragging FILES from OS, not internal reordering */}
      {isDragOver && !isReordering && (
        <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-card p-12 rounded-2xl shadow-2xl border-2 border-primary/50 flex flex-col items-center gap-6 animate-in zoom-in-95 duration-200 max-w-lg w-full">
            <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center ring-8 ring-primary/5">
              <FolderPlus className="w-12 h-12 text-primary animate-bounce" />
            </div>
            <div className="text-center space-y-2">
              <h3 className="text-2xl font-bold text-foreground">
                {(t as any).dropTitle || "閲婃斁浠ユ坊鍔犳枃浠?}
              </h3>
              <p className="text-base text-muted-foreground">
                {(t as any).dropHint || "鏀寔 .txt .epub .srt .ass 鏍煎紡"}
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              {["txt", "epub", "srt", "ass"].map((ext) => (
                <span
                  key={ext}
                  className="px-2.5 py-1 rounded-md bg-muted text-xs font-mono text-muted-foreground uppercase opacity-70"
                >
                  {ext}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-4">
        {/* Toolbar */}
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex items-center gap-1.5 p-1 bg-secondary/20 rounded-lg border border-border/10">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddFiles}
              disabled={isRunning}
              className={`h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <Plus className="w-3.5 h-3.5 mr-1" />
              {t.selectFiles}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddFolder}
              disabled={isRunning}
              className={`h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <FolderPlus className="w-3.5 h-3.5 mr-1" />
              {t.selectFolder}
            </Button>

            <div className="w-px h-4 bg-border/40 mx-1" />

            <div className="flex items-center gap-2 px-1.5">
              <Switch
                checked={scanSubdirs}
                onCheckedChange={setScanSubdirs}
                className="scale-75 origin-left"
                id="scan-subdirs"
              />
              <label
                htmlFor="scan-subdirs"
                className="text-xs text-muted-foreground/80 hover:text-foreground cursor-pointer select-none whitespace-nowrap -ml-1 transition-colors"
              >
                {(t as any).scanSubdirs || "Scan Subdirs"}
              </label>
            </div>
            <div className="w-px h-4 bg-border/40 mx-1" />
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenBatchConfig}
              className="h-7 text-xs font-medium px-3 hover:bg-primary/10 hover:text-primary transition-colors border-none shadow-none"
              disabled={selectedItems.size === 0}
            >
              <Settings2 className="w-3.5 h-3.5 mr-1" />
              {selectedItems.size > 0
                ? `${t.batchConfig} (${selectedItems.size})`
                : t.batchConfig}
            </Button>
          </div>

          <div className="flex-1" />

          {queue.length > 0 && (
            <div className="flex items-center gap-1.5 p-1 bg-secondary/5 rounded-lg border border-border/10">
              {selectedItems.size > 0 && (
                <span className="h-7 px-2.5 flex items-center justify-center text-[11px] text-primary font-bold rounded-md bg-primary/10 border border-primary/20 min-w-[60px] text-center shadow-sm animate-in fade-in zoom-in duration-200">
                  {selectedItems.size} {lang === "zh" ? "宸查€? : "Selected"}
                </span>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleSelectAll}
                className="h-7 text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all rounded-md px-3 border-border/50 hover:border-primary/30"
              >
                {selectedItems.size === queue.length
                  ? lang === "zh"
                    ? "鍙栨秷鍏ㄩ€?
                    : "Deselect All"
                  : lang === "zh"
                    ? "鍏ㄩ€?
                    : "Select All"}
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={handleInvertSelection}
                className="h-7 text-[11px] font-medium text-muted-foreground hover:text-primary hover:bg-primary/5 transition-all rounded-md px-3 border-border/50 hover:border-primary/30"
              >
                {lang === "zh" ? "鍙嶉€? : "Invert"}
              </Button>
              {selectedItems.size > 0 ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRemoveSelected}
                  disabled={isRunning}
                  className={`h-7 text-[11px] font-medium text-red-500/80 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-md px-3 border-border/50 hover:border-red-500/30 ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  {t.remove}
                </Button>
              ) : (
                <div className="flex items-center gap-2">
                  {queue.some((i) => i.status === "completed") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearCompleted}
                      disabled={isRunning}
                      className={`h-7 text-[10px] font-bold text-green-600/60 hover:text-green-600 hover:bg-green-500/10 transition-all rounded-md px-2 border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <Check className="w-3 h-3 mr-1 opacity-50" />
                      {lang === "zh" ? "娓呴櫎宸插畬鎴? : "Clear Completed"}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    disabled={isRunning}
                    className={`h-7 text-[10px] font-bold text-muted-foreground/40 hover:text-red-500 hover:bg-red-500/5 transition-all rounded-md px-2 border-none shadow-none ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                  >
                    <Trash2 className="w-3 h-3 mr-1 opacity-50" />
                    {t.clear}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        {/* Queue Card */}
        <Card className="flex-1 flex flex-col overflow-hidden border-border/50 shadow-sm bg-card/30">
          {/* Queue Header - More minimal */}
          {queue.length > 0 && (
            <div className="px-4 py-2 border-b border-border/40 flex items-center justify-between shrink-0 bg-secondary/5">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider pl-2">
                  File Queue
                </span>
              </div>
            </div>
          )}

          {/* Queue List */}
          <div className="flex-1 overflow-y-auto w-full relative">
            {queue.length === 0 ? (
              <div className="absolute inset-0 flex items-center justify-center p-8 bg-gradient-to-b from-transparent to-primary/[0.02]">
                <div
                  className={`w-full max-w-2xl h-80 border-2 border-dashed border-primary/20 bg-primary/[0.03] rounded-[2rem] flex flex-col items-center justify-center gap-6 transition-all duration-500 group relative overflow-hidden ${isRunning ? "opacity-50 cursor-not-allowed" : "hover:border-primary/40 hover:bg-primary/[0.06] hover:shadow-2xl hover:shadow-primary/5 cursor-pointer"}`}
                  onClick={handleAddFiles}
                >
                  {/* Subtle background decoration */}
                  <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full -mr-16 -mt-16 blur-3xl" />
                  <div className="absolute bottom-0 left-0 w-32 h-32 bg-primary/5 rounded-full -ml-16 -mb-16 blur-3xl" />

                  <div className="w-24 h-24 rounded-3xl bg-background shadow-sm border border-primary/10 flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 group-hover:border-primary/30 transition-all duration-500 shadow-primary/5">
                    <Plus className="w-10 h-10 text-primary/40 group-hover:text-primary transition-colors" />
                  </div>

                  <div className="text-center space-y-2 relative z-10">
                    <h3 className="text-xl font-bold text-foreground tracking-tight">
                      {(t as any).dropTitle || "鎷栨斁鏂囦欢鍒拌繖閲?}
                    </h3>
                    <p className="text-sm text-muted-foreground/70">
                      {(t as any).emptyDragHint || "鎴栫偣鍑讳换鎰忓娴忚鏂囦欢"}
                    </p>
                  </div>

                  <div className="flex flex-wrap justify-center gap-2 mt-2 px-12 relative z-10">
                    {[".txt", ".epub", ".srt", ".ass"].map((ext) => (
                      <span
                        key={ext}
                        className="text-[10px] font-bold px-2 py-1 rounded-full bg-background border border-primary/10 text-muted-foreground/60 shadow-sm group-hover:border-primary/30 group-hover:text-primary/70 transition-all duration-500"
                      >
                        {ext}
                      </span>
                    ))}
                  </div>

                  {/* Hover hint */}
                  <div className="absolute bottom-4 opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex items-center gap-2 text-[10px] font-bold text-primary uppercase tracking-widest">
                    <Sparkles className="w-3 h-3" />
                    Ready to Translate
                  </div>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/30">
                {queue.map((item, index) => (
                  <div
                    key={item.id}
                    className={`
                                            flex items-center gap-3 px-4 py-3 transition-all group
                                            ${selectedItems.has(item.id)
                        ? "bg-primary/5"
                        : "hover:bg-secondary/30"
                      }
                                        `}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => handleReorderDrop(e, index)}
                  >
                    {/* Checkbox */}
                    <input
                      type="checkbox"
                      checked={selectedItems.has(item.id)}
                      onChange={() => toggleSelection(item.id)}
                      className="w-4 h-4 rounded border-border shrink-0 accent-primary"
                    />

                    {/* Drag Handle - Larger Hit Area */}
                    <div
                      className={`p-2 -m-1 rounded shrink-0 transition-colors ${isRunning ? "opacity-20 cursor-not-allowed" : "hover:bg-secondary cursor-grab active:cursor-grabbing text-muted-foreground/30 hover:text-foreground"}`}
                      draggable={!isRunning}
                      onDragStart={(e) => handleDragStart(e, index)}
                      onDragEnd={handleDragEnd}
                      title="Drag to reorder"
                    >
                      <GripVertical className="w-5 h-5" />
                    </div>

                    {/* File Icon */}
                    <FileIcon type={item.fileType} />

                    {/* File Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">
                        {item.fileName}
                      </p>
                      <div className="flex items-center gap-2">
                        <p
                          className="text-[11px] text-muted-foreground/60 truncate max-w-[300px]"
                          title={item.path}
                        >
                          {item.path}
                        </p>
                        {/* Status Badges */}
                        {item.config?.useGlobalDefaults === false && (
                          <span className="text-[9px] px-1.5 py-px rounded bg-purple-500/10 text-purple-500 font-medium">
                            Custom
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 shrink-0">
                      <UITooltip content={t.config}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 focus-visible:ring-0"
                          onClick={() => setConfigItem(item)}
                        >
                          <Settings className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                        </Button>
                      </UITooltip>

                      <UITooltip content={t.proofread}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 focus-visible:ring-0"
                          onClick={() => handleProofread(item)}
                        >
                          <ClipboardCheck
                            className={`w-4 h-4 ${item.status === "completed" ? "text-primary" : "text-muted-foreground"} hover:text-primary transition-colors`}
                          />
                        </Button>
                      </UITooltip>

                      <UITooltip content={t.moveToTop}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="w-8 h-8 focus-visible:ring-0"
                          onClick={() => handleMoveToTop(item.id)}
                        >
                          <ArrowUp className="w-4 h-4 text-muted-foreground hover:text-primary" />
                        </Button>
                      </UITooltip>

                      <UITooltip content={lang === "zh" ? "绉婚櫎" : "Remove"}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={`w-8 h-8 focus-visible:ring-0 ${isRunning ? "opacity-50 cursor-not-allowed" : ""}`}
                          onClick={() => handleRemove(item.id)}
                          disabled={isRunning}
                        >
                          <Trash2 className="w-4 h-4 text-muted-foreground hover:text-red-500" />
                        </Button>
                      </UITooltip>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

        {configItem && (
          <FileConfigModal
            item={configItem}
            lang={lang}
            onSave={(config) =>
              configItem.id === "batch"
                ? handleBatchSave(config)
                : handleSaveConfig(configItem.id, config)
            }
            onClose={() => setConfigItem(null)}
          />
        )}
        <AlertModal {...alertProps} />
      </div>
    </div>
  );
}

export default LibraryView;
