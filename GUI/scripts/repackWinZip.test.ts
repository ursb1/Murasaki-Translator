import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const {
  findFirstExistingPath,
  pickRuntimeExecutableName,
  resolveAppSourceRootName,
} = require("./repackWinZip.js");

const tempDirectories: string[] = [];

afterEach(() => {
  while (tempDirectories.length > 0) {
    const dir = tempDirectories.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("repackWinZip helpers", () => {
  it("selects the single top-level directory as app root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "murasaki-repack-test-"));
    tempDirectories.push(root);
    fs.mkdirSync(path.join(root, "Murasaki Translator"), { recursive: true });
    const entries = fs.readdirSync(root, { withFileTypes: true });

    expect(resolveAppSourceRootName(entries)).toBe("Murasaki Translator");
  });

  it("keeps extracted root when directory and files coexist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "murasaki-repack-test-"));
    tempDirectories.push(root);
    fs.mkdirSync(path.join(root, "Murasaki Translator"), { recursive: true });
    fs.writeFileSync(path.join(root, "README.txt"), "placeholder", "utf8");
    const entries = fs.readdirSync(root, { withFileTypes: true });

    expect(resolveAppSourceRootName(entries)).toBeNull();
  });

  it("prefers configured product executable name", () => {
    const exe = pickRuntimeExecutableName(
      ["Updater.exe", "Murasaki Translator.exe", "launcher-helper.exe"],
      "murasaki translator.exe",
    );
    expect(exe).toBe("Murasaki Translator.exe");
  });

  it("falls back to the most likely runtime executable", () => {
    const exe = pickRuntimeExecutableName(
      ["launcher.exe", "unins000.exe", "Murasaki Translator.exe"],
      null,
    );
    expect(exe).toBe("Murasaki Translator.exe");
  });

  it("picks first existing candidate file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "murasaki-repack-test-"));
    tempDirectories.push(root);
    fs.mkdirSync(path.join(root, "resources", "docs"), { recursive: true });
    fs.writeFileSync(path.join(root, "resources", "docs", "README.md"), "# readme", "utf8");
    fs.writeFileSync(path.join(root, "README.md"), "# fallback", "utf8");

    const selected = findFirstExistingPath(root, [
      path.join("resources", "docs", "README.md"),
      "README.md",
    ]);
    expect(selected).toBe(path.join(root, "resources", "docs", "README.md"));
  });
});
