# Murasaki Translator - macOS 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 适用包

- `*-arm64.dmg`（Apple Silicon）
- `*.dmg`（Intel x64）

## 系统要求

- **操作系统**：macOS 12.0+（Monterey 或更新）
- **芯片**：Apple Silicon（M1/M2/M3/M4）或 Intel x64
- **内存**：建议 16GB+

> [!TIP]
> Apple Silicon 默认走 Metal 加速，性能通常优于 Intel 机型。

## 快速开始

1. 打开 DMG 并将 `Murasaki Translator.app` 拖入 `Applications`  
2. 首次运行时右键应用 -> `打开`（绕过 Gatekeeper 首次确认）  
3. 在软件内下载模型，或手动放入：  
   `/Applications/Murasaki Translator.app/Contents/Resources/middleware/models`

## 常见问题

- **提示“无法打开”**：右键应用选择“打开”，或在系统设置 -> 隐私与安全中允许。
- **模型路径写入失败**：请确认你有应用目录写权限，或在设置中改为自定义模型目录。
- **性能偏慢**：Intel 机型建议降低并发，优先使用较小量化模型。

## 链接

- **项目主页**：https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**：https://huggingface.co/Murasaki-Project
- **问题反馈**：https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见包内协议文件。  
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator
