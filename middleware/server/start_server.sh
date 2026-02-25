#!/bin/bash
# Murasaki Translation API Server startup script (Modified: No Venv Mode)

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

MODEL=""
PORT="8000"
HOST="0.0.0.0"
API_KEY=""
ENABLE_OPENAI_PROXY="0"
OPENAI_PORT="8001"
OPENAI_PROXY_LOG="${OPENAI_PROXY_LOG:-${ROOT_DIR}/openai-proxy.log}"
OPENAI_PROXY_TIMEOUT="${OPENAI_PROXY_TIMEOUT:-30}"
# VENV_DIR 依然保留定义，但下文不再强制创建它
VENV_DIR="${ROOT_DIR}/.venv"
PYTHON_BIN="${MURASAKI_PYTHON_BIN:-python3}"

# --- 1. 确认系统 Python 是否可用 ---
if ! command -v "${PYTHON_BIN}" >/dev/null 2>&1; then
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
  elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
  else
    echo "[ERROR] Python not found. Please install python3."
    exit 1
  fi
fi

# --- 2. 核心修改：直接指定 PYTHON 变量为系统 Python ---
# 不再检查 .venv 文件夹，直接使用检测到的系统 python
PYTHON="${PYTHON_BIN}"
echo "[INFO] Using System Python: $("${PYTHON}" --version)"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --model) MODEL="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --api-key) API_KEY="$2"; shift 2 ;;
    --enable-openai-proxy) ENABLE_OPENAI_PROXY="1"; shift ;;
    --openai-port) OPENAI_PORT="$2"; shift 2 ;;
    *) shift ;;
  esac
done

# --- 3. 核心修改：移除自动创建 venv 和自动 pip install 的逻辑 ---
# 已删除原有的 if [[ ! -x ... ]] 块
# 已删除原有的 if ! "${PYTHON}" -c "import fastapi..." 块

# --- 4. 生成 API KEY (逻辑保持不变，但使用系统环境) ---
if [[ -z "${API_KEY}" ]]; then
  if [[ -n "${MURASAKI_API_KEY:-}" ]]; then
    API_KEY="${MURASAKI_API_KEY}"
  else
    API_KEY="$("${PYTHON}" - <<'PY'
import secrets
print(secrets.token_urlsafe(24))
PY
)"
  fi
fi

export MURASAKI_API_KEY="${API_KEY}"

# --- 5. 健康检查函数 (逻辑保持不变) ---
wait_for_openai_proxy() {
  local deadline=$((SECONDS + OPENAI_PROXY_TIMEOUT))
  while [ $SECONDS -lt $deadline ]; do
    if "$PYTHON" - <<'PY' >/dev/null 2>&1
import os, sys, urllib.request
url = os.environ.get("OPENAI_PROXY_HEALTH", "")
if not url: sys.exit(1)
try:
    with urllib.request.urlopen(url, timeout=1) as resp:
        sys.exit(0 if resp.status == 200 else 1)
except Exception: sys.exit(1)
PY
    then
      return 0
    fi
    if [[ -n "${OPENAI_PROXY_PID:-}" ]] && ! kill -0 "$OPENAI_PROXY_PID" 2>/dev/null; then
      return 1
    fi
    sleep 1
  done
  return 1
}

API_CMD=("${PYTHON}" server/api_server.py --host "$HOST" --port "$PORT" --api-key "$API_KEY")
[[ -n "$MODEL" ]] && API_CMD+=(--model "$MODEL")

cleanup() {
  [[ -n "${OPENAI_PROXY_PID:-}" ]] && kill "$OPENAI_PROXY_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

# --- 6. 启动代理和服务器 ---
if [[ "$ENABLE_OPENAI_PROXY" == "1" ]]; then
  if [[ ! -f "openai_proxy/server.py" ]]; then
    echo "[ERROR] openai_proxy/server.py not found"
    exit 1
  fi
  echo "[INFO] Starting OpenAI proxy on ${HOST}:${OPENAI_PORT}"
  (
    cd openai_proxy
    LLAMA_SERVER_URL="http://127.0.0.1:1145" \
      "${PYTHON}" -m uvicorn server:app --host "$HOST" --port "$OPENAI_PORT"
  ) >> "${OPENAI_PROXY_LOG}" 2>&1 &
  OPENAI_PROXY_PID=$!

  HEALTH_HOST="$HOST"
  if [[ "$HEALTH_HOST" == "0.0.0.0" || "$HEALTH_HOST" == "::" || -z "$HEALTH_HOST" ]]; then
    HEALTH_HOST="127.0.0.1"
  fi
  export OPENAI_PROXY_HEALTH="http://${HEALTH_HOST}:${OPENAI_PORT}/health"
  if ! wait_for_openai_proxy; then
    echo "[ERROR] OpenAI proxy failed to start"
    exit 1
  fi
fi

[[ "$ENABLE_OPENAI_PROXY" == "1" ]] && export MURASAKI_ENABLE_OPENAI_PROXY="1" || export MURASAKI_ENABLE_OPENAI_PROXY="0"

echo "[INFO] Starting API server on ${HOST}:${PORT}"
exec "${API_CMD[@]}"
