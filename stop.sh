#!/usr/bin/env sh
# AI Share 停止脚本（Linux / macOS）
set -eu

cd "$(dirname "$0")"

PORT="${PORT:-4737}"
echo "[ai-share] 正在停止占用端口 ${PORT} 的进程..."

if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
  PIDS="$(fuser "${PORT}/tcp" 2>/dev/null || true)"
else
  echo "[ai-share] 未找到 lsof/fuser，无法定位进程" >&2
  exit 1
fi

if [ -z "$PIDS" ]; then
  echo "[ai-share] 端口 ${PORT} 未被占用。"
  exit 0
fi

for pid in $PIDS; do
  echo "[ai-share] 结束 PID ${pid} ..."
  kill "$pid" 2>/dev/null || true
done

# 宽限期后强杀残留
sleep 1
for pid in $PIDS; do
  if kill -0 "$pid" 2>/dev/null; then
    echo "[ai-share] PID ${pid} 未退出，强制结束..."
    kill -9 "$pid" 2>/dev/null || true
  fi
done

echo "[ai-share] 完成。"
