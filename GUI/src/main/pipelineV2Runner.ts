import { ipcMain } from "electron";
import { spawn } from "child_process";
import { join } from "path";

type PythonPath = { type: "python" | "bundle"; path: string };

type RunnerDeps = {
  getPythonPath: () => PythonPath;
  getMiddlewarePath: () => string;
  sendLog: (payload: { runId: string; message: string; level?: string }) => void;
};

export const registerPipelineV2Runner = (deps: RunnerDeps) => {
  ipcMain.handle(
    "pipelinev2-run",
    async (_event, { filePath, pipelineId, profilesDir, outputPath }) => {
      const runId = Date.now().toString();
      const python = deps.getPythonPath();
      const middlewarePath = deps.getMiddlewarePath();
      const scriptPath = join(middlewarePath, "murasaki_flow_v2", "main.py");

      const args = [
        scriptPath,
        "--file",
        filePath,
        "--pipeline",
        pipelineId,
        "--profiles-dir",
        profilesDir,
      ];
      if (outputPath) {
        args.push("--output", outputPath);
      }

      return await new Promise<{ ok: boolean; runId: string; code?: number }>(
        (resolve) => {
          const child =
            python.type === "bundle"
              ? spawn(python.path, args.slice(1))
              : spawn(python.path, args, { cwd: middlewarePath });

          child.stdout?.on("data", (buf) => {
            deps.sendLog({ runId, message: buf.toString(), level: "info" });
          });
          child.stderr?.on("data", (buf) => {
            deps.sendLog({ runId, message: buf.toString(), level: "error" });
          });
          child.on("close", (code) => {
            resolve({ ok: code === 0, runId, code: code ?? undefined });
          });
        },
      );
    },
  );
};
