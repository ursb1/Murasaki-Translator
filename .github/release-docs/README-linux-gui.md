# Murasaki Translator - Linux GUI 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 适用包

- `*.AppImage`（桌面端 GUI）

## 系统要求

- **发行版**：Ubuntu 20.04+ / Debian 11+ / 其他现代 Linux 发行版
- **显卡**：
  - NVIDIA：建议安装较新驱动
  - AMD / Intel：需可用 Vulkan 驱动（如 `mesa-vulkan-drivers`）
- **基础依赖**：`libvulkan1`

## 快速开始（AppImage）

```bash
chmod +x Murasaki-Translator-*.AppImage
./Murasaki-Translator-*.AppImage
```

首次启动后，建议在软件内置“模型管理”中直接下载模型；  
如果手动管理模型，请在设置页指定自定义模型目录。

## 常见问题

- **无法执行 AppImage**：先执行 `chmod +x`，并确认下载文件未损坏。
- **提示 FUSE 相关错误**：安装系统对应 FUSE 运行库后重试。
- **GPU 不可用**：检查 Vulkan 驱动是否安装、`vulkaninfo` 是否可执行。

## 链接

- **项目主页**：https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**：https://huggingface.co/Murasaki-Project
- **问题反馈**：https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见包内协议文件。  
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator
