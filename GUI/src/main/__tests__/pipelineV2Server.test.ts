import { beforeEach, describe, expect, it } from "vitest";
import {
  __testOnly,
  getPipelineV2Status,
  markPipelineV2Local,
  markPipelineV2ServerOk,
} from "../pipelineV2Server";

describe("pipelineV2Server status", () => {
  beforeEach(() => {
    markPipelineV2ServerOk();
  });

  it("updates status when marking local failures and recovery", () => {
    markPipelineV2Local("spawn_error", "detail");
    const local = getPipelineV2Status();
    expect(local.mode).toBe("local");
    expect(local.ok).toBe(false);
    expect(local.error).toBe("spawn_error");
    expect(local.detail).toBe("detail");

    markPipelineV2ServerOk();
    const recovered = getPipelineV2Status();
    expect(recovered.mode).toBe("server");
    expect(recovered.ok).toBe(true);
    expect(recovered.error).toBeUndefined();
    expect(recovered.detail).toBeUndefined();
  });

  it("returns a snapshot copy", () => {
    const snapshot = getPipelineV2Status();
    snapshot.mode = "local";
    const next = getPipelineV2Status();
    expect(next.mode).toBe("server");
  });
});

describe("pipelineV2Server bundle args", () => {
  it("keeps script path when bundle path points to python interpreter", () => {
    const args = ["api_server.py", "--port", "48321"];
    expect(__testOnly.resolveBundleArgs("python3", args)).toEqual(args);
    expect(__testOnly.resolveBundleArgs("python.exe", args)).toEqual(args);
  });

  it("drops script path for packaged bundle executable", () => {
    const args = ["api_server.py", "--port", "48321"];
    expect(__testOnly.resolveBundleArgs("murasaki-server", args)).toEqual([
      "--port",
      "48321",
    ]);
  });
});
