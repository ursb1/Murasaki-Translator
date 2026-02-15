import { app, ipcMain } from "electron";
import { join, basename, extname } from "path";
import { existsSync } from "fs";
import { copyFile, mkdir, readdir, readFile, unlink, writeFile } from "fs/promises";
import yaml from "js-yaml";
import {
  ensurePipelineV2Server,
  getPipelineV2Status,
  markPipelineV2Local,
  markPipelineV2ServerOk,
  retryPipelineV2Server,
} from "./pipelineV2Server";

const PROFILE_KINDS = ["api", "prompt", "parser", "policy", "chunk", "pipeline"] as const;
export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const getPipelineV2ProfilesDir = () =>
  join(app.getPath("userData"), "pipeline_v2_profiles");

type PythonPath = { type: "python" | "bundle"; path: string };

type ProfileDeps = {
  getPythonPath: () => PythonPath;
  getMiddlewarePath: () => string;
  getProfilesDir?: () => string;
};

const normalizeBaseUrl = (value: string) => value.trim().replace(/\/+$/, "");

const buildModelsUrl = (baseUrl: string) => {
  const clean = normalizeBaseUrl(baseUrl);
  if (!clean) return "";
  if (clean.endsWith("/models")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/models`;
  return `${clean}/v1/models`;
};

const requestWithTimeout = async (
  url: string,
  options: RequestInit,
  timeoutMs: number,
) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
};

const testApiConnection = async (
  baseUrl: string,
  apiKey?: string,
  timeoutMs = 8000,
) => {
  const url = buildModelsUrl(baseUrl);
  if (!url) return { ok: false, message: "base_url_missing" };
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const start = Date.now();
  try {
    const res = await requestWithTimeout(
      url,
      { method: "GET", headers },
      Math.max(1000, timeoutMs),
    );
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        latencyMs: Date.now() - start,
        url,
        message: data?.error?.message || data?.detail || data || "request_failed",
      };
    }
    const modelCount = Array.isArray(data?.data) ? data.data.length : undefined;
    return {
      ok: true,
      status: res.status,
      latencyMs: Date.now() - start,
      url,
      modelCount,
    };
  } catch (error: any) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      url,
      message: error?.name === "AbortError" ? "timeout" : error?.message || "request_failed",
    };
  }
};

const requestJson = async (baseUrl: string, path: string, options?: RequestInit) => {
  const res = await fetch(`${baseUrl}${path}`, {
    headers: { "Content-Type": "application/json", ...(options?.headers || {}) },
    ...options,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const detail = data?.detail || data || "request_failed";
    return { ok: false, error: detail };
  }
  return { ok: true, data };
};

type LocalProfileRef = {
  id: string;
  name: string;
  filename: string;
  path: string;
};

const safeLoadYaml = (raw: string): Record<string, any> | null => {
  try {
    const data = yaml.load(raw);
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    return data as Record<string, any>;
  } catch {
    return null;
  }
};

const dumpYaml = (data: Record<string, any>) =>
  yaml.dump(data, { lineWidth: 120, sortKeys: false, noRefs: true });

const ensureLocalProfiles = async (profilesDir: string, middlewarePath: string) => {
  for (const kind of PROFILE_KINDS) {
    await mkdir(join(profilesDir, kind), { recursive: true });
  }
  const defaultsRoot = join(middlewarePath, "murasaki_flow_v2", "profiles");
  if (!existsSync(defaultsRoot)) return;
  for (const kind of PROFILE_KINDS) {
    const sourceDir = join(defaultsRoot, kind);
    if (!existsSync(sourceDir)) continue;
    const files = await readdir(sourceDir).catch(() => []);
    for (const file of files) {
      const ext = extname(file).toLowerCase();
      if (ext !== ".yaml" && ext !== ".yml") continue;
      const target = join(profilesDir, kind, file);
      if (existsSync(target)) continue;
      await copyFile(join(sourceDir, file), target);
    }
  }
};

const listProfileRefsLocal = async (
  kind: ProfileKind,
  profilesDir: string,
): Promise<LocalProfileRef[]> => {
  const dir = join(profilesDir, kind);
  const files = (await readdir(dir).catch(() => [])).sort();
  const result: LocalProfileRef[] = [];
  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (ext !== ".yaml" && ext !== ".yml") continue;
    const fullPath = join(dir, file);
    const fallbackId = basename(file, ext);
    let id = fallbackId;
    let name = fallbackId;
    try {
      const raw = await readFile(fullPath, "utf-8");
      const data = safeLoadYaml(raw);
      if (data?.id) id = String(data.id);
      if (data?.name) name = String(data.name);
    } catch {
      // ignore read errors
    }
    result.push({ id, name, filename: file, path: fullPath });
  }
  return result;
};

const resolveProfilePathLocal = async (
  kind: ProfileKind,
  ref: string,
  profilesDir: string,
): Promise<string | null> => {
  if (!ref) return null;
  if (existsSync(ref)) return ref;
  if (ref.endsWith(".yaml") || ref.endsWith(".yml")) {
    const direct = join(profilesDir, kind, ref);
    if (existsSync(direct)) return direct;
  }
  const directYaml = join(profilesDir, kind, `${ref}.yaml`);
  if (existsSync(directYaml)) return directYaml;
  const directYml = join(profilesDir, kind, `${ref}.yml`);
  if (existsSync(directYml)) return directYml;
  const refs = await listProfileRefsLocal(kind, profilesDir);
  const matched = refs.find((item) => item.id === ref);
  return matched ? matched.path : null;
};

const loadProfileLocal = async (
  kind: ProfileKind,
  ref: string,
  profilesDir: string,
) => {
  const path = await resolveProfilePathLocal(kind, ref, profilesDir);
  if (!path) return null;
  const raw = await readFile(path, "utf-8");
  const data = safeLoadYaml(raw) || {};
  const id = String(data.id || basename(path, extname(path)));
  const name = String(data.name || id);
  return { id, name, yaml: raw, data };
};

const saveProfileLocal = async (
  kind: ProfileKind,
  ref: string,
  yamlText: string,
  profilesDir: string,
) => {
  const parsed = safeLoadYaml(yamlText);
  if (!parsed) return { ok: false, error: "invalid_yaml" };
  if (!parsed.id) parsed.id = ref;
  const target = join(profilesDir, kind, `${parsed.id}.yaml`);
  await writeFile(target, dumpYaml(parsed), "utf-8");
  return { ok: true, id: String(parsed.id), warnings: [] as string[] };
};

const deleteProfileLocal = async (
  kind: ProfileKind,
  ref: string,
  profilesDir: string,
) => {
  const path = await resolveProfilePathLocal(kind, ref, profilesDir);
  if (path && existsSync(path)) {
    await unlink(path).catch(() => null);
  }
  return { ok: true };
};

export const registerPipelineV2Profiles = (deps: ProfileDeps) => {
  const getProfilesDir = deps.getProfilesDir || getPipelineV2ProfilesDir;
  const ensureServer = async () => {
    try {
      const baseUrl = await ensurePipelineV2Server({
        getPythonPath: deps.getPythonPath,
        getMiddlewarePath: deps.getMiddlewarePath,
        getProfilesDir,
      });
      return baseUrl;
    } catch (error: any) {
      markPipelineV2Local(
        "server_unavailable",
        error?.message || "server_unavailable",
      );
      return null;
    }
  };

  const ensureLocalDir = async () => {
    const dir = getProfilesDir();
    await ensureLocalProfiles(dir, deps.getMiddlewarePath());
    return dir;
  };

  ipcMain.handle("pipelinev2-status", async () => getPipelineV2Status());

  ipcMain.handle(
    "pipelinev2-retry",
    async () =>
      retryPipelineV2Server({
        getPythonPath: deps.getPythonPath,
        getMiddlewarePath: deps.getMiddlewarePath,
        getProfilesDir,
      }),
  );

  ipcMain.handle("pipelinev2-profiles-path", async () => {
    const baseUrl = await ensureServer();
    if (baseUrl) {
      try {
        const result = await requestJson(baseUrl, "/profiles/dir");
        if (result.ok) {
          markPipelineV2ServerOk();
          return result.data?.path;
        }
      } catch (error: any) {
        markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");
      }
    }
    return await ensureLocalDir();
  });

  ipcMain.handle("pipelinev2-profiles-list", async (_event, kind: ProfileKind) => {
    if (!PROFILE_KINDS.includes(kind)) return [];
    const baseUrl = await ensureServer();
    if (baseUrl) {
      try {
        const result = await requestJson(baseUrl, `/profiles/${kind}`);
        if (result.ok) {
          markPipelineV2ServerOk();
          return result.data;
        }
      } catch (error: any) {
        markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");
      }
    }
    const localDir = await ensureLocalDir();
    const refs = await listProfileRefsLocal(kind, localDir);
    return refs.map((item) => ({
      id: item.id,
      name: item.name,
      filename: item.filename,
    }));
  });

  ipcMain.handle(
    "pipelinev2-profiles-load",
    async (_event, kind: ProfileKind, id: string) => {
      if (!PROFILE_KINDS.includes(kind)) return null;
      const baseUrl = await ensureServer();
      if (baseUrl) {
        try {
          const result = await requestJson(baseUrl, `/profiles/${kind}/${id}`);
          if (result.ok) {
            markPipelineV2ServerOk();
            return result.data;
          }
        } catch (error: any) {
          markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");
        }
      }
      const localDir = await ensureLocalDir();
      return await loadProfileLocal(kind, id, localDir);
    },
  );

  ipcMain.handle(
    "pipelinev2-profiles-save",
    async (_event, kind: ProfileKind, id: string, yamlText: string) => {
      if (!PROFILE_KINDS.includes(kind)) return { ok: false };
      const baseUrl = await ensureServer();
      if (baseUrl) {
        try {
          const result = await requestJson(baseUrl, `/profiles/${kind}/${id}`, {
            method: "POST",
            body: JSON.stringify({ yaml: yamlText }),
          });
          if (!result.ok) return { ok: false, error: result.error };
          markPipelineV2ServerOk();
          return { ok: true, id: result.data?.id, warnings: result.data?.warnings };
        } catch (error: any) {
          markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");
        }
      }
      const localDir = await ensureLocalDir();
      return await saveProfileLocal(kind, id, yamlText, localDir);
    },
  );

  ipcMain.handle(
    "pipelinev2-profiles-delete",
    async (_event, kind: ProfileKind, id: string) => {
      if (!PROFILE_KINDS.includes(kind)) return { ok: false };
      const baseUrl = await ensureServer();
      if (baseUrl) {
        try {
          const result = await requestJson(baseUrl, `/profiles/${kind}/${id}`, {
            method: "DELETE",
          });
          if (!result.ok) return { ok: false, error: result.error };
          markPipelineV2ServerOk();
          return result.data;
        } catch (error: any) {
          markPipelineV2Local("fetch_failed", error?.message || "fetch_failed");
        }
      }
      const localDir = await ensureLocalDir();
      return await deleteProfileLocal(kind, id, localDir);
    },
  );

  ipcMain.handle(
    "pipelinev2-api-test",
    async (_event, payload: { baseUrl: string; apiKey?: string; timeoutMs?: number }) =>
      testApiConnection(payload?.baseUrl || "", payload?.apiKey, payload?.timeoutMs),
  );
};
