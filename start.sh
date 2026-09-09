#!/usr/bin/env sh
# AI Share 启动脚本（Linux / macOS）
# 用法: ./start.sh          前台启动
#       ./start.sh -d       后台启动（日志写入 server.log）
#
# 注意: MCP 桥接器 (mcp-bridge.js) 是 stdio 协议的 MCP server，
#       必须由 Claude / Cursor / CodeBuddy 等 MCP 客户端按需拉起，不能用本脚本常驻。
#       在客户端配置里指向: node <ai-share 目录>/mcp-bridge.js 即可（可设 AI_SHARE_URL）。
set -eu

cd "$(dirname "$0")"

PORT="${PORT:-4737}"

# --- 检查 Node ---
if ! command -v node >/dev/null 2>&1; then
  echo "[ai-share] 未找到 node，请先安装 Node.js >= 16: https://nodejs.org/" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 16 ]; then
  echo "[ai-share] Node 版本过低（当前 $(node --version)），需要 >= 16" >&2
  exit 1
fi

# --- 释放被占用的端口 ---
echo "[ai-share] 正在检查端口 ${PORT} ..."
if command -v lsof >/dev/null 2>&1; then
  PIDS="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null || true)"
elif command -v fuser >/dev/null 2>&1; then
  PIDS="$(fuser "${PORT}/tcp" 2>/dev/null || true)"
else
  PIDS=""
  echo "[ai-share] 未找到 lsof/fuser，跳过端口检查" >&2
fi

for pid in $PIDS; do
  echo "[ai-share] 端口被 PID ${pid} 占用，正在结束..."
  kill "$pid" 2>/dev/null || true
done
[ -n "$PIDS" ] && sleep 1

# --- 启动 ---
echo "[ai-share] 启动服务 (http://localhost:${PORT}) ..."
if [ "${1:-}" = "-d" ]; then
  PORT="$PORT" setsid node server.js >server.log 2>&1 < /dev/null &
  echo "[ai-share] 已后台启动 (PID $!), 日志: server.log"
else
  PORT="$PORT" exec node server.js
fi
