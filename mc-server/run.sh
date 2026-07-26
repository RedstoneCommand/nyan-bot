#!/bin/bash
# 喵bot 守护脚本 — 单实例锁 + 崩溃后等 3 分钟重连
cd "$(dirname "$(readlink -f "$0")")" || exit 1
LOCKFILE="nyanbot.lock"
MYPID=$$

# 单实例锁
if [ -f "$LOCKFILE" ]; then
    OLD_PID=$(cat "$LOCKFILE")
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        echo "[$(date)] ⚠️ 另一个喵bot守护进程已在运行 (PID $OLD_PID)，退出"
        exit 1
    fi
    echo "[$(date)] 🧹 清理过期锁文件 (旧 PID: $OLD_PID)"
fi
echo "$MYPID" > "$LOCKFILE"

NODE_BIN=$(command -v node)
if [ -z "$NODE_BIN" ]; then
    echo "[$(date)] ❌ 找不到 node，请安装 Node.js 或设置 PATH"
    exit 1
fi

while true; do
  echo "[$(date)] 🚀 喵bot 启动..."
  "$NODE_BIN" index.js
  EXIT_CODE=$?
  echo "[$(date)] ⚠️ 喵bot 退出 (exit=$EXIT_CODE)，3 分钟后重连..."
  sleep 180
done
