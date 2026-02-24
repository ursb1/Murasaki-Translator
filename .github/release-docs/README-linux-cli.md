# Murasaki Translator - Linux Server 包

> 面向远程部署的无界面服务端。  
> 同时支持 GUI 全功能远程接口（`/api/v1/*`）与 OpenAI 兼容接口（`/v1/*`）。

## 适用场景

- 云服务器 / 本地 Linux 主机部署推理服务
- Windows GUI 通过 Remote 模式接入
- 其他应用通过 OpenAI SDK 直接接入

## 环境要求

- Linux x64（推荐 Ubuntu 20.04+ / Debian 11+）
- Python 3.10+
- 可用 GPU 驱动（NVIDIA 或 Vulkan 栈）

## 一行部署（推荐）

```bash
MODEL='/path/to/model.gguf'; API_KEY='replace-with-strong-key'; curl -fsSL https://github.com/soundstarrain/Murasaki-Translator/releases/latest/download/murasaki-server-linux-x64.tar.gz | tar -xz && cd murasaki-server && nohup ./start.sh --host 0.0.0.0 --port 8000 --model "$MODEL" --api-key "$API_KEY" --enable-openai-proxy --openai-port 8001 > server.log 2>&1 &
```

启动后默认地址：

- GUI Remote URL：`http://<server-ip>:8000`
- OpenAI Base URL：`http://<server-ip>:8001/v1`
- 鉴权：`Authorization: Bearer <API_KEY>`

## 接口说明

- 健康检查（公开）：`GET /health`
- GUI Remote（鉴权）：`/api/v1/*`
- OpenAI 兼容（鉴权）：`/v1/*`

常用 GUI Remote 接口：

- `POST /api/v1/translate`
- `GET /api/v1/translate/{task_id}`
- `DELETE /api/v1/translate/{task_id}`
- `POST /api/v1/upload/file`
- `GET /api/v1/download/{task_id}`
- `WS /api/v1/ws/{task_id}`

## 快速验证

```bash
curl -fsS http://127.0.0.1:8000/health
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8000/api/v1/status
curl -fsS -H "Authorization: Bearer $API_KEY" http://127.0.0.1:8001/v1/models
```

`/health` 中应包含能力标识：

- `api_v1`
- `api_v1_full_parity`
- `openai_v1`

## Windows GUI 连接参数

- `Server URL`：`http://<server-ip>:8000`
- `API Key`：部署时设置的 `API_KEY`

## 常见问题

- **401 / 403**：API Key 不一致，确认请求头为 `Authorization: Bearer <API_KEY>`。
- **连接超时**：防火墙或安全组未放行 `8000`/`8001` 端口。
- **实时日志不更新**：反向代理缺少 WebSocket Upgrade 头。

## 安全建议

- 公网部署务必使用强 API Key
- 仅对可信来源开放端口
- 对外服务建议通过 HTTPS 反向代理

## 协议

软件代码采用 Apache-2.0 协议开源，详见包内协议文件。  
模型权重采用 CC BY-NC-SA 4.0 协议。

---
Copyright © 2026 Murasaki Translator
