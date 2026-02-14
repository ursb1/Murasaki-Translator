import { platform, arch } from "os";
import { join } from "path";
import { existsSync, chmodSync } from "fs";
import { is } from "@electron-toolkit/utils";

type PlatformOS = "win32" | "darwin" | "linux";
type Backend = "cuda" | "vulkan" | "metal" | "cpu";

interface PlatformInfo {
  os: PlatformOS;
  arch: "x64" | "arm64";
  backend: Backend;
  binaryName: string;
  binaryDir: string;
  subdir: string;
}

// 缓存 GPU 检测结果，避免重复执行
let cachedHasNvidiaGpu: boolean | null = null;

/**
 * 同步检测 NVIDIA GPU - 仅用于必须同步的场景
 * 增加超时到 3000ms，并尝试多个可能的 nvidia-smi 路径
 */
function hasNvidiaGpuSync(): boolean {
  if (cachedHasNvidiaGpu !== null) {
    return cachedHasNvidiaGpu;
  }

  const { execSync } = require("child_process");

  // Windows 上 nvidia-smi 可能不在 PATH 中，尝试多个路径
  const commands =
    process.platform === "win32"
      ? [
          "nvidia-smi --query-gpu=name --format=csv,noheader",
          '"C:\\Windows\\System32\\nvidia-smi.exe" --query-gpu=name --format=csv,noheader',
          '"C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe" --query-gpu=name --format=csv,noheader',
        ]
      : ["nvidia-smi --query-gpu=name --format=csv,noheader"];

  for (const cmd of commands) {
    try {
      const result = execSync(cmd, {
        encoding: "utf8",
        timeout: 3000, // 增加超时到 3 秒
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      if (result.trim().length > 0) {
        cachedHasNvidiaGpu = true;
        console.log(`[Platform] NVIDIA GPU detected: ${result.trim()}`);
        return true;
      }
    } catch {
      // 尝试下一个路径
    }
  }

  cachedHasNvidiaGpu = false;
  console.log("[Platform] No NVIDIA GPU detected, using Vulkan/Metal fallback");
  return false;
}

/**
 * 获取 middleware 目录路径
 */
export function getMiddlewarePath(): string {
  if (is.dev) {
    return join(__dirname, "../../../middleware");
  }
  return join(process.resourcesPath, "middleware");
}

/**
 * 检测当前平台并返回对应的二进制配置
 */
export function detectPlatform(): PlatformInfo {
  const os = platform() as PlatformOS;
  const cpuArch = arch() as "x64" | "arm64";

  let backend: Backend;
  let subdir: string;

  switch (os) {
    case "win32":
      // Windows: 优先 CUDA，回退 Vulkan
      if (hasNvidiaGpuSync()) {
        backend = "cuda";
        subdir = "win-cuda";
      } else {
        backend = "vulkan";
        subdir = "win-vulkan";
      }
      break;

    case "darwin":
      // macOS: ARM64 用 Metal，x64 用 CPU
      if (cpuArch === "arm64") {
        backend = "metal";
        subdir = "darwin-metal";
      } else {
        backend = "cpu";
        subdir = "darwin-x64";
      }
      break;

    case "linux":
      // Linux: 优先 CUDA（如果有 NVIDIA GPU），回退 Vulkan
      if (hasNvidiaGpuSync()) {
        backend = "cuda";
        subdir = "linux-cuda";
      } else {
        backend = "vulkan";
        subdir = "linux-vulkan";
      }
      break;

    default:
      throw new Error(`Unsupported platform: ${os}`);
  }

  const middlewareDir = getMiddlewarePath();
  const binaryDir = join(middlewareDir, "bin", subdir);
  const binaryName = os === "win32" ? "llama-server.exe" : "llama-server";

  return { os, arch: cpuArch, backend, binaryName, binaryDir, subdir };
}

/**
 * 获取 llama-server 可执行文件的完整路径
 * 首先尝试新的 bin/ 目录结构，回退到旧的目录结构
 */
export function getLlamaServerPath(): string {
  const middlewareDir = getMiddlewarePath();
  const info = detectPlatform();
  const binaryName = info.binaryName;

  const fallbackSubdirsByOs: Record<PlatformOS, string[]> = {
    win32: ["win-cuda", "win-vulkan", "win-cpu"],
    darwin: ["darwin-metal", "darwin-x64"],
    linux: ["linux-cuda", "linux-vulkan", "linux-cpu"],
  };

  const orderedSubdirs = [
    info.subdir,
    ...fallbackSubdirsByOs[info.os].filter((subdir) => subdir !== info.subdir),
  ];

  for (const subdir of orderedSubdirs) {
    const candidate = join(middlewareDir, "bin", subdir, binaryName);
    if (!existsSync(candidate)) continue;

    if (info.os !== "win32") {
      try {
        chmodSync(candidate, 0o755);
      } catch {
        // ignore chmod failure and continue with executable check
      }
    }

    if (subdir !== info.subdir) {
      console.log(
        `[platform] Preferred backend binary missing, fallback to: ${subdir}`,
      );
    }
    return candidate;
  }

  const newPath = join(info.binaryDir, info.binaryName);

  // 2. 回退：扫描 middleware 目录下的旧结构
  const fs = require("fs");
  if (existsSync(middlewareDir)) {
    for (const subdir of fs.readdirSync(middlewareDir)) {
      const candidate = join(middlewareDir, subdir, binaryName);
      if (existsSync(candidate)) {
        if (info.os !== "win32") {
          try {
            chmodSync(candidate, 0o755);
          } catch {
            // ignore chmod failure and continue
          }
        }
        console.log(`[platform] Using legacy path: ${candidate}`);
        return candidate;
      }
    }
  }

  throw new Error(`llama-server not found. Checked: ${newPath}`);
}
