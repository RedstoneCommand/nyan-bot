// ===================================================================
//  消息输出模块 — say() & whisperTo()
// ===================================================================

const config = require('./config');

let msgQueue = null;  // 由 index.js 调用 setMsgQueue() 注入

function setMsgQueue(mq) { msgQueue = mq; }

// 日志写入（统一出口）
function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] [喵bot] ${msg}\n`;
  try { require('fs').appendFileSync(require('./config').LOG_FILE, line); } catch (e) { /* log write failed, skip */ }
}

// 公屏聊天（统一出口）
function say(msg) {
  const bot = config.getBot();
  if (!bot || typeof bot.chat !== 'function') { log('[SAY FAIL] bot.chat not ready'); return; }
  let clean = msg.replace(/^@\S+\s*/, '');
  clean = clean.replace(/&#x([0-9A-Fa-f]{6})/g, '&#$1');
  clean = clean.replace(/\n+/g, ' ');
  log(`[SAY] ${clean.substring(0, 80)}`);
  if (msgQueue) msgQueue.send(clean);
}

// 私信回复
function whisperTo(player, msg) {
  const bot = config.getBot();
  if (!bot || typeof bot.chat !== 'function') { log('[WHISPER FAIL] bot.chat not ready'); return; }
  let clean = msg.replace(/^@\S+\s*/, '');
  clean = clean.replace(/&#x([0-9A-Fa-f]{6})/g, '&#$1');
  try {
    bot._client.write('chat_command', { command: 'msg ' + player + ' ' + clean });
    log(`[WHISPER → ${player}] /msg ${clean.substring(0, 60)}`);
  } catch (e) {
    log(`[WHISPER FAIL] ${e.message}`);
    say(`@${player} ${clean}`);
  }
}

module.exports = { setMsgQueue, log, say, whisperTo };
