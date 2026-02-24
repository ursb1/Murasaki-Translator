const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const APP_DIR_NAME = "app";
const LAUNCHER_ICON_SIZE = 256;
const ROOT_README_NAME = "README.md";
const ROOT_LICENSE_NAME = "LICENSE.txt";
const README_CANDIDATES = [
  path.join("resources", "docs", "README.md"),
  path.join("resources", "docs", "readme.md"),
  "README.md",
];
const LICENSE_CANDIDATES = [
  path.join("resources", "docs", "LICENSE.txt"),
  path.join("resources", "docs", "LICENSE.Murasaki Translator.txt"),
  "LICENSE.txt",
  "LICENSE",
];

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const details = [
      `[repackWinZip] Command failed: ${command} ${args.join(" ")}`,
      result.stdout?.trim() ? `stdout:\n${result.stdout.trim()}` : "",
      result.stderr?.trim() ? `stderr:\n${result.stderr.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(details);
  }
  return result;
}

function toPowerShellString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function runPowerShell(script) {
  runCommand("powershell", ["-NoProfile", "-Command", script]);
}

function readDirectoryEntries(directoryPath) {
  return fs.readdirSync(directoryPath, { withFileTypes: true }).filter((entry) => {
    return entry.name !== "__MACOSX" && entry.name !== ".DS_Store";
  });
}

function resolveAppSourceRootName(entries) {
  const folders = entries.filter((entry) => entry.isDirectory());
  const files = entries.filter((entry) => entry.isFile());
  if (folders.length === 1 && files.length === 0) {
    return folders[0].name;
  }
  return null;
}

function pickRuntimeExecutableName(exeNames, preferredExeName) {
  const candidates = [...new Set(exeNames.filter((name) => name.toLowerCase().endsWith(".exe")))];
  if (candidates.length === 0) {
    return null;
  }

  if (preferredExeName) {
    const preferred = candidates.find(
      (name) => name.toLowerCase() === preferredExeName.toLowerCase(),
    );
    if (preferred) {
      return preferred;
    }
  }

  const score = (name) => {
    let value = 0;
    if (/unins|uninstall/i.test(name)) value += 1000;
    if (/launcher/i.test(name)) value += 500;
    if (/setup|updater|update/i.test(name)) value += 200;
    value += name.length;
    return value;
  };

  return candidates.sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0];
}

function findFirstExistingPath(basePath, relativeCandidates) {
  for (const relativePath of relativeCandidates) {
    const absolutePath = path.join(basePath, relativePath);
    if (fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile()) {
      return absolutePath;
    }
  }
  return null;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function copyDirectoryContents(sourceDirectory, destinationDirectory) {
  ensureDirectory(destinationDirectory);
  for (const entry of fs.readdirSync(sourceDirectory, { withFileTypes: true })) {
    fs.cpSync(path.join(sourceDirectory, entry.name), path.join(destinationDirectory, entry.name), {
      recursive: true,
    });
  }
}

function parsePngDimensions(pngBuffer) {
  const pngSignatureHex = "89504e470d0a1a0a";
  if (!Buffer.isBuffer(pngBuffer) || pngBuffer.length < 24) {
    throw new Error("[repackWinZip] Invalid PNG buffer.");
  }
  if (pngBuffer.subarray(0, 8).toString("hex") !== pngSignatureHex) {
    throw new Error("[repackWinZip] PNG signature mismatch.");
  }
  const width = pngBuffer.readUInt32BE(16);
  const height = pngBuffer.readUInt32BE(20);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("[repackWinZip] Invalid PNG dimensions.");
  }
  return { width, height };
}

function buildIcoFromPngBuffer(pngBuffer) {
  const { width, height } = parsePngDimensions(pngBuffer);
  const iconDirAndEntry = Buffer.alloc(6 + 16);
  iconDirAndEntry.writeUInt16LE(0, 0); // ICONDIR: reserved
  iconDirAndEntry.writeUInt16LE(1, 2); // ICONDIR: image type (1 = icon)
  iconDirAndEntry.writeUInt16LE(1, 4); // ICONDIR: image count
  iconDirAndEntry.writeUInt8(width >= 256 ? 0 : width, 6); // ICONDIRENTRY width
  iconDirAndEntry.writeUInt8(height >= 256 ? 0 : height, 7); // ICONDIRENTRY height
  iconDirAndEntry.writeUInt8(0, 8); // ICONDIRENTRY color count
  iconDirAndEntry.writeUInt8(0, 9); // ICONDIRENTRY reserved
  iconDirAndEntry.writeUInt16LE(1, 10); // ICONDIRENTRY planes
  iconDirAndEntry.writeUInt16LE(32, 12); // ICONDIRENTRY bpp
  iconDirAndEntry.writeUInt32LE(pngBuffer.length, 14); // ICONDIRENTRY bytes in resource
  iconDirAndEntry.writeUInt32LE(iconDirAndEntry.length, 18); // ICONDIRENTRY image offset
  return Buffer.concat([iconDirAndEntry, pngBuffer]);
}

function createLauncherIconIco(sourcePngPath, targetIcoPath) {
  if (!fs.existsSync(sourcePngPath)) {
    throw new Error(`[repackWinZip] Launcher icon source not found: ${sourcePngPath}`);
  }

  const resizedPngPath = `${targetIcoPath}.resized.png`;
  try {
    runPowerShell(`
Add-Type -AssemblyName System.Drawing;
$srcPath = ${toPowerShellString(sourcePngPath)};
$dstPath = ${toPowerShellString(resizedPngPath)};
$src = [System.Drawing.Image]::FromFile($srcPath);
try {
  $bmp = New-Object System.Drawing.Bitmap ${LAUNCHER_ICON_SIZE}, ${LAUNCHER_ICON_SIZE};
  try {
    $g = [System.Drawing.Graphics]::FromImage($bmp);
    try {
      $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality;
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic;
      $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality;
      $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality;
      $g.DrawImage($src, 0, 0, ${LAUNCHER_ICON_SIZE}, ${LAUNCHER_ICON_SIZE});
    } finally {
      $g.Dispose();
    }
    $bmp.Save($dstPath, [System.Drawing.Imaging.ImageFormat]::Png);
  } finally {
    $bmp.Dispose();
  }
} finally {
  $src.Dispose();
}
`);

    const resizedPngBuffer = fs.readFileSync(resizedPngPath);
    const icoBuffer = buildIcoFromPngBuffer(resizedPngBuffer);
    fs.writeFileSync(targetIcoPath, icoBuffer);
  } finally {
    fs.rmSync(resizedPngPath, { force: true });
  }
}

function createLauncherExecutable(outputPath, runtimeRelativePath, launcherIconPngPath) {
  const tempProjectDir = fs.mkdtempSync(path.join(os.tmpdir(), "murasaki-launcher-"));
  try {
    const projectFilePath = path.join(tempProjectDir, "MurasakiLauncher.csproj");
    const programFilePath = path.join(tempProjectDir, "Program.cs");
    const launcherIconIcoPath = path.join(tempProjectDir, "launcher.ico");
    const escapedRuntimePath = runtimeRelativePath
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');

    createLauncherIconIco(launcherIconPngPath, launcherIconIcoPath);

    const projectContent = `\
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>WinExe</OutputType>
    <TargetFramework>net48</TargetFramework>
    <AssemblyName>MurasakiLauncher</AssemblyName>
    <RootNamespace>MurasakiLauncher</RootNamespace>
    <ApplicationIcon>launcher.ico</ApplicationIcon>
    <Nullable>disable</Nullable>
  </PropertyGroup>
</Project>
`;

    const programContent = `\
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;

internal static class Program
{
    private static readonly string RuntimeRelativePath = "${escapedRuntimePath}";

    [STAThread]
    private static int Main(string[] args)
    {
        string baseDirectory = AppDomain.CurrentDomain.BaseDirectory;
        string runtimeExecutablePath = Path.GetFullPath(Path.Combine(baseDirectory, RuntimeRelativePath));

        if (!File.Exists(runtimeExecutablePath))
        {
            return 2;
        }

        var startInfo = new ProcessStartInfo
        {
            FileName = runtimeExecutablePath,
            WorkingDirectory = Path.GetDirectoryName(runtimeExecutablePath) ?? baseDirectory,
            UseShellExecute = false,
            Arguments = JoinArguments(args)
        };

        try
        {
            Process child = Process.Start(startInfo);
            return child == null ? 3 : 0;
        }
        catch
        {
            return 4;
        }
    }

    private static string JoinArguments(string[] args)
    {
        if (args == null || args.Length == 0)
        {
            return string.Empty;
        }

        return string.Join(" ", args.Select(QuoteWindowsArgument));
    }

    private static string QuoteWindowsArgument(string argument)
    {
        if (argument == null)
        {
            return "\\\"\\\"";
        }

        if (argument.Length == 0)
        {
            return "\\\"\\\"";
        }

        bool requiresQuotes = argument.Any(ch => char.IsWhiteSpace(ch) || ch == '\\\"');
        if (!requiresQuotes)
        {
            return argument;
        }

        var builder = new StringBuilder();
        builder.Append('\\\"');
        int consecutiveBackslashes = 0;

        foreach (char character in argument)
        {
            if (character == '\\\\')
            {
                consecutiveBackslashes++;
                continue;
            }

            if (character == '\\\"')
            {
                builder.Append('\\\\', consecutiveBackslashes * 2 + 1);
                builder.Append('\\\"');
                consecutiveBackslashes = 0;
                continue;
            }

            if (consecutiveBackslashes > 0)
            {
                builder.Append('\\\\', consecutiveBackslashes);
                consecutiveBackslashes = 0;
            }

            builder.Append(character);
        }

        if (consecutiveBackslashes > 0)
        {
            builder.Append('\\\\', consecutiveBackslashes * 2);
        }

        builder.Append('\\\"');
        return builder.ToString();
    }
}
`;

    fs.writeFileSync(projectFilePath, projectContent, "utf8");
    fs.writeFileSync(programFilePath, programContent, "utf8");

    runCommand("dotnet", ["build", projectFilePath, "-c", "Release", "-nologo"], {
      cwd: tempProjectDir,
    });

    const builtExecutablePath = path.join(
      tempProjectDir,
      "bin",
      "Release",
      "net48",
      "MurasakiLauncher.exe",
    );
    if (!fs.existsSync(builtExecutablePath)) {
      throw new Error(`[repackWinZip] Launcher build output missing: ${builtExecutablePath}`);
    }

    fs.copyFileSync(builtExecutablePath, outputPath);
  } finally {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
  }
}

function repackZipArchive(
  zipPath,
  preferredExecutableName,
  fallbackReadmePath,
  fallbackLicensePath,
  launcherIconPngPath,
) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "murasaki-repack-"));
  const extractedDirectory = path.join(tempRoot, "extracted");
  const stageDirectory = path.join(tempRoot, "stage");
  ensureDirectory(extractedDirectory);
  ensureDirectory(stageDirectory);

  try {
    console.log(`[repackWinZip] Repacking: ${zipPath}`);

    runPowerShell(
      `Expand-Archive -Path ${toPowerShellString(zipPath)} -DestinationPath ${toPowerShellString(extractedDirectory)} -Force`,
    );

    const extractedEntries = readDirectoryEntries(extractedDirectory);
    const singleRootName = resolveAppSourceRootName(extractedEntries);
    const appSourceRoot = singleRootName
      ? path.join(extractedDirectory, singleRootName)
      : extractedDirectory;

    const executableCandidates = readDirectoryEntries(appSourceRoot)
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".exe"))
      .map((entry) => entry.name);
    const runtimeExecutableName = pickRuntimeExecutableName(
      executableCandidates,
      preferredExecutableName,
    );

    if (!runtimeExecutableName) {
      throw new Error(`[repackWinZip] Runtime executable not found in: ${appSourceRoot}`);
    }

    const runtimeDirectory = path.join(stageDirectory, APP_DIR_NAME);
    copyDirectoryContents(appSourceRoot, runtimeDirectory);

    const readmeSourcePath =
      findFirstExistingPath(runtimeDirectory, README_CANDIDATES) || fallbackReadmePath;
    const licenseSourcePath =
      findFirstExistingPath(runtimeDirectory, LICENSE_CANDIDATES) || fallbackLicensePath;

    if (!readmeSourcePath || !fs.existsSync(readmeSourcePath)) {
      throw new Error("[repackWinZip] README source file not found.");
    }
    if (!licenseSourcePath || !fs.existsSync(licenseSourcePath)) {
      throw new Error("[repackWinZip] LICENSE source file not found.");
    }

    const launcherPath = path.join(stageDirectory, runtimeExecutableName);
    createLauncherExecutable(
      launcherPath,
      path.join(APP_DIR_NAME, runtimeExecutableName),
      launcherIconPngPath,
    );

    fs.copyFileSync(readmeSourcePath, path.join(stageDirectory, ROOT_README_NAME));
    fs.copyFileSync(licenseSourcePath, path.join(stageDirectory, ROOT_LICENSE_NAME));

    const repackedZipPath = path.join(tempRoot, path.basename(zipPath));
    const archiveSourceWildcard = path.join(stageDirectory, "*");
    runPowerShell(
      `Compress-Archive -Path ${toPowerShellString(archiveSourceWildcard)} -DestinationPath ${toPowerShellString(repackedZipPath)} -Force`,
    );

    fs.copyFileSync(repackedZipPath, zipPath);
    console.log(`[repackWinZip] Repacked successfully: ${zipPath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function main() {
  if (process.platform !== "win32") {
    console.log("[repackWinZip] Skip: only runs on Windows.");
    return;
  }

  const guiDirectory = path.resolve(__dirname, "..");
  const repositoryRoot = path.resolve(guiDirectory, "..");
  const distDirectory = path.join(guiDirectory, "dist");
  const fallbackReadmePath = path.join(repositoryRoot, "README.md");
  const fallbackLicensePath = path.join(repositoryRoot, "LICENSE");
  const launcherIconPngPath = path.join(guiDirectory, "resources", "icon.png");

  if (!fs.existsSync(distDirectory)) {
    console.log(`[repackWinZip] Dist directory not found, skip: ${distDirectory}`);
    return;
  }
  if (!fs.existsSync(launcherIconPngPath)) {
    throw new Error(`[repackWinZip] Icon source not found: ${launcherIconPngPath}`);
  }

  const packageJsonPath = path.join(guiDirectory, "package.json");
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  const preferredExecutableName = packageJson?.build?.productName
    ? `${packageJson.build.productName}.exe`
    : null;

  const zipFiles = fs
    .readdirSync(distDirectory)
    .filter((name) => name.toLowerCase().endsWith(".zip"))
    .map((name) => path.join(distDirectory, name));

  if (zipFiles.length === 0) {
    console.log("[repackWinZip] No zip artifacts found in dist, skip.");
    return;
  }

  for (const zipPath of zipFiles) {
    repackZipArchive(
      zipPath,
      preferredExecutableName,
      fallbackReadmePath,
      fallbackLicensePath,
      launcherIconPngPath,
    );
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

module.exports = {
  resolveAppSourceRootName,
  pickRuntimeExecutableName,
  findFirstExistingPath,
  parsePngDimensions,
  buildIcoFromPngBuffer,
};
