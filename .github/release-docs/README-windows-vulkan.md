# Murasaki Translator - Windows Vulkan 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 适用包

- `*-win-vulkan-x64.zip`（AMD / Intel / NVIDIA 通用）

## 解压后目录结构

```text
Murasaki-Translator-xxx-win-vulkan-x64/
├─ Murasaki Translator.exe        # 根目录启动器
├─ README.md
├─ LICENSE.txt
└─ app/                           # 实际运行时目录
   ├─ Murasaki Translator.exe
   ├─ *.dll / *.pak / locales/
   └─ resources/
      ├─ middleware/
      │  ├─ models/
      │  └─ ...
      └─ python_env/
```

## 系统要求

- **操作系统**：Windows 10/11 x64
- **显卡**：AMD / Intel / NVIDIA（需支持 Vulkan 1.2）
- **驱动**：建议更新到厂商最新稳定版

> [!TIP]
> AMD/Intel 用户优先使用 Vulkan 版本；NVIDIA 用户若条件允许可优先 CUDA 版本。

## 快速开始

1. 前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 GGUF 模型文件  
2. 将模型放入 `app\resources\middleware\models`  
3. 双击根目录 `Murasaki Translator.exe` 启动

## 常见问题

- **无法启动**：先更新显卡驱动，确认系统支持 Vulkan 1.2。
- **速度偏慢**：适当降低并发数，或改用更小量化模型。
- **NVIDIA 性能不理想**：可尝试 CUDA 版本压缩包。

## 链接

- **项目主页**：https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**：https://huggingface.co/Murasaki-Project
- **问题反馈**：https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见根目录 `LICENSE.txt`。  
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator
