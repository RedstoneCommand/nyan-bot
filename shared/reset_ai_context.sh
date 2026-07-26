#!/bin/bash
# 喵酱 AI 上下文清理脚本
# Bot 上下文在内存中，需要重启进程

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG="$SCRIPT_DIR/reset_ai_context.log"
MAX_RETRIES=5

echo "[$(date -u +%Y-%m-%dT%H:%M:%S.000Z)] 🧹 开始清理 AI 上下文..." >> "$LOG"

# ---- 智能延迟检测 ----
get_last_ts() {
  local logfile="$1"
  local latest_ts=0
  [ ! -f "$logfile" ] && { echo 0; return; }
  while IFS= read -r line; do
    local ts=$(echo "$line" | grep -oP '\[\K[0-9T:.Z-]+(?=\])' | head -1)
    if [ -n "$ts" ]; then
      local unix_ts=$(date -d "$ts" +%s 2>/dev/null)
      [ -n "$unix_ts" ] && [ "$unix_ts" -gt "$latest_ts" ] && latest_ts=$unix_ts
    fi
  done < <(grep -E '(💬|🧠 AI|🤖 LLM)' "$logfile" 2>/dev/null | tail -10)
  echo $latest_ts
}

is_chatting() {
  local now=$(date -u +%s)
  local cutoff=$((now - 900))
  local bot_ts=$(get_last_ts "$PROJECT_DIR/mc-server/nyanbot.log")
  [ "$bot_ts" -gt "$cutoff" ] 2>/dev/null && echo "活跃中" && return 0
  return 1
}

retry=0
while [ $retry -lt $MAX_RETRIES ]; do
  activity=$(is_chatting)
  if [ $? -eq 0 ]; then
    retry=$((retry + 1))
    echo "  ⏳ 15分钟内有聊天，第${retry}次推迟30分钟..." >> "$LOG"
    sleep 1800
  else
    break
  fi
done
[ $retry -ge $MAX_RETRIES ] && echo "  ⚠️ 已推后 ${MAX_RETRIES} 次，强制清理" >> "$LOG"

# ---- 清理消息队列 ----
> "$PROJECT_DIR/mc-server/mc_messages.log" 2>/dev/null
> "$PROJECT_DIR/mc-server/ai_reply_queue.log" 2>/dev/null
echo "  ✅ 消息队列已清空" >> "$LOG"

# ---- 重启 bot（杀双进程防冲突） ----
DAEMON_PID=$(pgrep -f "run.sh" 2>/dev/null | grep -v grep | head -1)
if [ -n "$DAEMON_PID" ]; then
  kill "$DAEMON_PID" 2>/dev/null
  echo "  ✅ daemon (PID $DAEMON_PID) 已停止" >> "$LOG"
  sleep 1
fi

BOT_PID=$(pgrep -f "node.*mc-server.*index" 2>/dev/null | grep -v grep | head -1)
if [ -n "$BOT_PID" ]; then
  kill "$BOT_PID" 2>/dev/null
  echo "  ✅ bot (PID $BOT_PID) 已停止" >> "$LOG"
  sleep 2
fi

# 清理旧锁文件
rm -f "$PROJECT_DIR/mc-server/nyanbot.lock"

# 重新启动 daemon
cd "$PROJECT_DIR/mc-server" && nohup bash run.sh >> daemon.log 2>&1 &
echo "  ✅ daemon 已重启 (PID $!)" >> "$LOG"

echo "[$(date -u +%Y-%m-%dT%H:%M:%S.000Z)] ✅ 清理完成" >> "$LOG"
