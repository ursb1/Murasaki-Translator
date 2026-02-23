import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteClient } from "../remoteClient";

describe("RemoteClient async file io", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("downloadCache 使用异步 writeFile 落盘", async () => {
    const client = new RemoteClient({ url: "http://127.0.0.1:8000" });

    const bytes = new Uint8Array([1, 2, 3]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => bytes.buffer,
      } satisfies Partial<Response>),
    );

    const root = mkdtempSync(join(tmpdir(), "remote-client-cache-"));
    const output = join(root, "cache.json");
    try {
      await client.downloadCache("task-1", output);
      expect(readFileSync(output).equals(Buffer.from([1, 2, 3]))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uploadFile 使用异步 readFile 读取并上传", async () => {
    const client = new RemoteClient({ url: "http://127.0.0.1:8000" });
    const fetchFormDataSpy = vi
      .spyOn(client as any, "fetchFormData")
      .mockResolvedValue({
        file_id: "file_1",
        file_path: "/uploads/file_1.txt",
      });

    const root = mkdtempSync(join(tmpdir(), "remote-client-upload-"));
    const input = join(root, "input.txt");
    let result: { fileId: string; serverPath: string } | null = null;
    try {
      writeFileSync(input, "unit", "utf-8");
      result = await client.uploadFile(input);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }

    expect(fetchFormDataSpy).toHaveBeenCalledTimes(1);
    expect(fetchFormDataSpy).toHaveBeenCalledWith(
      "/api/v1/upload/file",
      expect.any(FormData),
    );
    const form = fetchFormDataSpy.mock.calls[0]?.[1] as FormData;
    const fileBlob = form.get("file");
    expect(fileBlob).toBeInstanceOf(Blob);
    expect((fileBlob as Blob).size).toBe(4);
    expect(result).toEqual({
      fileId: "file_1",
      serverPath: "/uploads/file_1.txt",
    });
  });

  it("remoteClient 不再使用同步读写 API", () => {
    const source = readFileSync("src/main/remoteClient.ts", "utf-8");
    expect(source).not.toContain("writeFileSync(");
    expect(source).not.toContain("readFileSync(");
  });
});
