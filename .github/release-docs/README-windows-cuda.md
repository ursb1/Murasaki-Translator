# Murasaki Translator - Windows CUDA 版本

> 原生 CoT 与长上下文能力的 ACGN 文本翻译器

## 适用包

- `*-win-cuda-x64.zip`（NVIDIA CUDA 加速）

## 解压后目录结构

```text
Murasaki-Translator-xxx-win-cuda-x64/
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
- **显卡**：NVIDIA 显卡（推荐 6GB+ 显存）
- **驱动**：建议 `551.61+`（支持 CUDA 12.4）

> [!NOTE]
> 无需单独安装 CUDA Toolkit，更新显卡驱动即可。

## 快速开始

1. 前往 [Hugging Face](https://huggingface.co/Murasaki-Project) 下载 GGUF 模型文件  
2. 将模型放入 `app\resources\middleware\models`  
3. 双击根目录 `Murasaki Translator.exe` 启动

## 常见问题

- **启动器无响应**：请确认 `app\Murasaki Translator.exe` 存在，且压缩包已完整解压。
- **CUDA 未生效**：先检查驱动版本，再确认是否下载了 CUDA 版本压缩包。
- **显存不足**：建议切换更小量化（如 `Q4_K_M`）或降低并发数。

## 链接

- **项目主页**：https://github.com/soundstarrain/Murasaki-Translator
- **模型下载**：https://huggingface.co/Murasaki-Project
- **问题反馈**：https://github.com/soundstarrain/Murasaki-Translator/issues

## 协议

软件代码采用 Apache-2.0 协议开源，详见根目录 `LICENSE.txt`。  
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator
